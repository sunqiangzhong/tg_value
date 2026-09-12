# Telegram 账户安全审计（2026-09-12）

## 修复进展（同日）

已修改工作区源码并重新构建 backend/dist/index.js，尚未部署或重启真实服务。下方审计发现保留为修复前记录。

- 电话、二维码、2FA 和旧版登录在运行客户端接管前关闭登录连接，关闭失败不交接。
- 移除绑定账户和新增订阅时自动执行的全量权限扫描；权限检查由用户手动触发。已经启用的订阅仍按原有设置同步，不会被静默关闭。
- 权限检查按账户串行并通过账户池租用连接；收到限流、授权重复或账户停用错误立即停止该账户后续探测，记录冷却或失效。保留服务端返回的等待秒数。
- 账户默认访问、直接访问及调度都排除冷却和失效账户；订阅扫描使用账户调度并处理账户级异常，开始下载前释放扫描租用，避免单连接账户被自身阻塞。
- 账户池禁用库内自动短时 FLOOD 睡眠重试。重启或重新启用不能绕过数据库中的冷却时间；如果在冷却期间重启，等待结束后需要再次显式启用该账户以建连。
- 离线审计脚本已改为安全行为断言，不能再用于复现修复前行为。

验证：Telegram 模块 234 项回归测试通过；随后新增边界测试的定向 37 项测试通过；类型检查和后端构建通过。均未使用真实 Telegram 账户。修复不能解除 Telegram 服务器已经施加的登录限制，也不能证明原始事故的原因。

范围限制：本次没有实现跨进程的 Telegram Session 独占锁；部署时仍应只运行一个使用这些账户 Session 的应用实例。

本次针对当前工作区源码中的账户绑定、账户启用、Bot `/list`、权限探测和订阅后台任务进行定向审计。用户报告：绑定并启用账户级下载后，仅执行 list，随后全部设备被强制退出、已有 Passkey 失效。尚未取得部署现场错误日志或确认部署版本与工作区一致。

结论：存在可离线复现的账户连接生命周期和错误处理缺陷；目前没有证据把它们定为此次全账户失效、封禁或删除的确定原因。全设备退出和 Passkey 失效不能仅凭本项目 Session 作废来解释，也不能单凭这些现象判定账户已永久删除。

## P1：登录客户端未关闭，就激活同一 Session 的运行客户端

- `backend/src/services/telegramMultiAccountLoginFlows.ts:361` 在登录客户端仍连接时调用 `onAuthorized`；关闭在外层 finally（345、353 行）。
- `backend/src/services/telegramMultiAccountLoginAdapter.ts:41` 在该回调中激活客户端，随后 43 行等待完整权限扫描。
- `backend/src/services/telegramUserClientPool.ts:126` 创建另一个 TelegramClient，使用保存的同一 StringSession 连接，并执行授权检查、getMe。
- 旧版网页登录也存在同样顺序：`backend/src/services/telegramUserWebLogin.ts:142` 先 persistAndActivate，146 行才关闭登录客户端。

因此两条主连接存在重叠窗口，自动扫描会延长该窗口。离线脚本证明了调用顺序；没有用真实账户制造并发请求或实际触发 Telegram 处罚。

Telegram 官方说明：同一授权在非媒体 DC 上超过允许的并行主会话数量，可能触发 AUTH_KEY_DUPLICATED 并使该授权密钥失效，需要重新登录。这不是账户删除的证明，也不能据此解释其他独立设备授权及 Passkey 的全部变化。

建议：读取身份并保存 Session 后先可靠关闭登录连接，再交接运行客户端；关闭失败不得继续建连。为旧版、电话、二维码、2FA 成功路径分别验证交接顺序。

参考：https://core.telegram.org/api/errors 、https://core.telegram.org/api/datacenter

## P1：权限扫描收到限流或账户失效后仍继续访问

`backend/src/services/telegramAccountAccessSweep.ts:186` 将 RPC 异常转换为结果；282–304 行继续所有后续任务，只写入来源权限结果，没有账户冷却、账户断开或停止剩余探测。

生产适配器 `backend/src/services/telegramAccountAccessSweepAdapter.ts` 直接取得池内客户端，绕过带冷却及连接计数的 select 调度路径。默认扫描并发为 2，单个账户也可能同时探测两个 scope。

离线测试设为串行以排除已在途请求：分别让第一个请求开始持续抛出 FLOOD_WAIT_300、AUTH_KEY_DUPLICATED、USER_DEACTIVATED_BAN，每种情形仍访问了全部 6 个探测项，整体标记 completed。

建议：限流立即记录账户冷却；失效立即停止该账户并清除运行连接；剩余探测标记跳过。所有账户请求使用统一调度及错误分类。

## P1：自动扫描与后台订阅可在没有手动下载时访问账户

`backend/src/services/telegramMultiAccountLoginAdapter.ts:38` 默认 enabled=true，43 行自动触发 account_created 扫描；生产适配器选择全部启用订阅，逐个检查 channel 和 comments。

每个订阅通常会执行两次 getEntity、两次最新消息 getMessages，以及一次评论 getMessages（最新消息存在时），底层 RPC 数还取决于实体解析和库实现。如果没有启用的订阅，此处不会发起频道探测，不能把这一发现强套到本次事故。

`backend/src/services/telegramChannelJobs.ts:2021` 的订阅 worker 在账户可用后读取启用订阅，可能创建同步任务并下载。`2434` 行启动即扫描，之后默认每 300 秒运行。已有订阅或可恢复任务意味着“本次没有按下载”不等于后台完全没有活动。

建议：绑定与启用业务流量分开；新账户不应自动扫描全部历史订阅。显式展示待扫描范围和后台任务，按需探测。

## P2：授权重复错误未按失效处理，默认客户端绕过冷却筛选

`backend/src/services/telegramUserClientPool.ts:68` 的失效判断缺少 AUTH_KEY_DUPLICATED；`telegramMultiAccountRuntime.ts` 因而可能把已作废授权归类为 retryable。

`telegramUserClientPool.ts:182` 的 getDefaultClient 仅排序选择，没有检查 cooldownUntil 或连接状态；订阅扫描（telegramChannelJobs.ts:2031）直接调用该默认客户端，无法完整利用下载调度器的账户冷却策略。

建议：统一识别不可恢复授权错误；订阅扫描也通过账户选择、租用和释放机制访问 Telegram。

## `/list` 与恶意操作检查结果

- `/list` 路径：`telegramBot.ts:1988` 校验身份 → `telegramCommands.ts:1047` handleList → 查询 files 数据库 → message.reply。没有个人账户登录、频道历史读取或下载调用。Bot 在 `telegramBot.ts:1527` 建立独立客户端，并用 botAuthToken 登录。
- 在 backend/src 应用源码中没有检索到 DeleteAccount、ResetAuthorizations、ResetAuthorization、LogOut、Passkey 删除或修改 Telegram 两步验证的调用。仓库的 deleteAccount 是清理本项目数据库记录和 Session，不是注销 Telegram 账户。
- 账户 Session 通过 `telegramAccountRepository.ts` 调用 AES-256-GCM 凭据加密存储，公开账户列表去除 session。已审阅登录链路中未发现向第三方地址发送 Session/验证码/密码的代码。
- 上述结论不是完整供应链或部署主机无入侵的证明。未对实际镜像、安装依赖内容、反向代理日志、数据库访问和外部网络流量做取证。

## 验证与现场取证

离线复现脚本：`backend/scripts/audit_telegram_account_safety.ts`。

运行：在 backend 目录执行 `node --import tsx scripts/audit_telegram_account_safety.ts`。2026-09-12 执行成功：连接交接顺序及三类错误后继续扫描均被断言确认。脚本仅调用纯逻辑模块与模拟对象，不连接 Telegram、数据库，也不读取真实凭据。其断言描述当前缺陷，修复后应改写为安全行为回归测试。

本次只增加审计文档与离线复现脚本，未修改生产逻辑、重启服务或登录真实账户。

建议先停止实际部署的项目并保留现场，避免继续请求。保留事故前后 10 分钟日志、容器镜像标识、后台订阅/任务状态及是否有多个实例共用数据库。只提取错误码和时间，不传播 Session、Token、验证码或密码。

优先检索 AUTH_KEY_DUPLICATED、SESSION_REVOKED、AUTH_KEY_UNREGISTERED、USER_DEACTIVATED、USER_DEACTIVATED_BAN、PHONE_NUMBER_BANNED、FLOOD_WAIT。区分首次错误和随后的连锁错误。

官方客户端原手机号的具体登录提示，是进一步区分授权撤销、号码封禁和账户删除的重要证据。Telegram 官方说明非官方 API 登录受到监测，并提供 API 使用后误封申诉渠道，但没有公开可据此认定本次触发原因的规则：https://core.telegram.org/api/obtaining_api_id 。
