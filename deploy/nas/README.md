# NAS 单容器部署

镜像包含 React 网页、Node API、PostgreSQL 17 和 ffmpeg，只启动一个容器。
支持 `linux/amd64`（Intel/AMD x86_64）和 `linux/arm64`（64 位 ARM），不支持 ARMv7/32 位系统。

镜像将生产依赖单独构建，只复制运行所需的依赖目录，不携带安装缓存；Google API SDK 的类型声明仅保留在构建阶段。图片处理使用 Sharp 自带的平台库，不重复安装系统 libvips。PostgreSQL、数据库扩展和 ffmpeg 保留。两种架构的容器测试包含图片缩放/WebP 编码和 Google Drive SDK 加载检查。

2026-09-10 本地对照构建：Docker 报告的 AMD64 镜像大小从 182.7 MB 降至 156.8 MB（约减少 14.2%）；容器内 `node_modules` 从 354 MiB 降至 194 MiB。AMD64 和 ARM64 均通过构建及容器测试，其中 ARM64 使用 Docker Desktop 模拟运行；GitHub 原生 ARM runner 仍需在推送后验证。镜像大小会随基础镜像和系统软件包更新而变化。

## 一次性配置 GitHub Actions

1. 在你有推送权限的 GitHub 仓库中保存这些代码（也可以先 Fork）。
2. 在 Docker Hub 创建 `tg-vault` 仓库；公开仓库可直接拉取。
3. GitHub → Settings → Secrets and variables → Actions，添加：
   - `DOCKER_USERNAME`：Docker Hub 用户名。
   - `DOCKER_PASSWORD`：有 Read & Write 权限的 Docker Hub access token。
4. 把代码提交并推送到 `docker-hub` 分支：

```bash
git switch -c docker-hub
git add Dockerfile compose.local.yaml .dockerignore .gitattributes backend/src/index.ts backend/src/services/frontend.ts backend/src/services/frontend.test.ts .github/workflows/docker-all-in-one.yml deploy/all-in-one-entrypoint.sh deploy/test-all-in-one.sh deploy/nas README.md
git add backend/src/i18n/telegram.test.ts backend/src/services/telegramTaskCenter.test.ts frontend/src/services/nativeDialogContract.test.ts frontend/src/i18n/russianTypography.test.ts frontend/src/components/pages/telegramUserAccountsPanelContract.test.ts
git commit -m "Add single-container NAS deployment"
git push -u origin docker-hub
```

分支已存在时使用 `git switch docker-hub`。Actions 中的 `Publish single-container NAS image` 会执行检查，在两种架构上构建并测试真实容器，通过后发布：

- `用户名/tg-vault:docker-hub`
- `用户名/tg-vault:latest`
- `用户名/tg-vault:完整提交SHA`（用于固定版本）

AMD64 和 ARM64 都必须构建并通过容器测试后才会发布，避免 ARM64 失败时仍把仅有 AMD64 的镜像标记为成功。两种架构共享 `latest`、`docker-hub` 和提交标签。ARM64 依赖需要的 Python/C++ 编译工具仅存在于构建阶段，不会增加最终镜像体积。

PR 只构建测试。手动运行 workflow 时选择 `docker-hub` 分支才会发布。
原有 `docker-publish.yml` 仍用于 main/master 的分体镜像，不发布这里的一体镜像。

## 修改完成后发布新镜像

在项目根目录确认当前位于 `docker-hub` 分支，然后提交并推送全部修改：

```bash
git switch docker-hub
git status
git add -A
git commit -m "描述本次修改"
git push origin docker-hub
```

推送会自动运行 GitHub Actions 的 `Publish single-container NAS image`。在仓库的 **Actions** 页面等待 `verify`、两种架构的 `build` 和 `publish` 完成；成功后 Docker Hub 的 `sunqz/tg-vault:latest` 会更新。NAS 端执行：

```bash
docker compose pull
docker compose up -d
docker compose logs --tail=100
```

如果 `git status` 显示没有修改，就不需要创建空提交。需要手动重新发布当前提交时，在 GitHub Actions 页面选择该工作流和 `docker-hub` 分支，再点击 **Run workflow**。

## NAS 启动

NAS 只需要本目录的 `compose.yaml` 和 `env.example`，不需要源码或本地构建。

```bash
mkdir -p /volume1/docker/tg-vault
cd /volume1/docker/tg-vault
# 把 compose.yaml 和 env.example 放到此目录
cp env.example .env
```

把 `.env` 中 `YOUR_DOCKERHUB_USERNAME` 换成实际用户名。然后：

```bash
docker compose up -d
```

访问 `http://NAS的IP:8080`，完成首次账号初始化，再在设置页配置 Telegram 和存储。
Compose 会自动拉取镜像并选择匹配架构；私有镜像先执行 `docker login`。
此配置默认用于局域网 HTTP。使用 NAS HTTPS 反向代理时，把目标设为 NAS 的 8080 端口，设置 `PUBLIC_URL=https://你的域名` 和 `COOKIE_SECURE=true`；代理应保留 Host 并设置 X-Forwarded-Proto，`TRUST_PROXY` 填代理的 IP 或可信子网。
云盘 OAuth 需要填写 `PUBLIC_URL`（完整访问 origin，不带末尾 `/`），并在服务商配置对应回调地址。

### 飞牛公网 / Cloudflare Tunnel 登录出现 403

`Origin not allowed` 表示浏览器访问地址没有通过后端的来源校验。隧道的内部 HTTP 地址可能和浏览器使用的 HTTPS 域名不同；飞牛公网入口还可能使用不同端口。

在 NAS 的 `.env` 中明确填写浏览器地址栏里的入口，例如：

```dotenv
PUBLIC_URL=https://cloud.example.com
CORS_ORIGIN=https://cloud.example.com,https://nas.example.com:8443
COOKIE_SECURE=true
```

替换为自己的真实地址，保留实际端口，不带路径或末尾 `/`。`PUBLIC_URL` 只填一个主入口，用于 OAuth；`CORS_ORIGIN` 可用英文逗号分隔多个入口，留空时沿用 `PUBLIC_URL`。不要使用 `*` 解决登录问题。HTTPS Cookie 需要通过 HTTPS 入口使用。

更新本目录的 `compose.yaml` 后重新创建容器，使 `.env` 生效：

```bash
docker compose up -d --force-recreate
```

如果通过飞牛界面直接创建容器，请在容器环境变量中直接设置 `CORS_ORIGIN`，仅设置 `PUBLIC_URL` 不会自动转换为应用配置。

显式允许的入口不依赖代理是否保留 Host。若使用自动同源识别，则 `TRUST_PROXY` 必须包含实际连接容器的代理 IP 或可信子网；代理需要覆盖 `X-Forwarded-Proto`，保留原始 Host 或设置包含公网端口的 `X-Forwarded-Host`。默认 `loopback` 不包含其他 Docker 容器或局域网代理。

### 容器使用代理

Clash/Mihomo 开启“允许局域网连接”，并使用 mixed 端口时，只需在 `.env` 设置：

```dotenv
PROXY_HOST=192.168.5.199:7890
```

容器会自动把这个地址用于 HTTP/HTTPS 请求和 Telegram MTProto。Telegram Bot、用户账号登录、频道扫描以及图片和视频分片下载都会使用该代理。修改后重新创建容器：

```bash
docker compose up -d --force-recreate
docker compose logs --tail=100
```

需要分别指定代理时，可以使用 `HTTP_PROXY`、`HTTPS_PROXY` 和 `TELEGRAM_PROXY_URL=socks5://主机:端口` 覆盖自动配置。

## 更新和备份

发布成功后，在同一目录执行：

```bash
docker compose up -d
docker compose logs --tail=100
```

`pull_policy: always` 会拉取标签的最新镜像。数据保存在 `tg-vault_vault-data` 持久卷，包含数据库、文件、缩略图、Telegram 会话和加密密钥。不要用 `docker compose down -v`，它会删除数据。
备份整个卷前先 `docker compose stop`，备份完成后 `docker compose start`；数据库逻辑备份可执行：

```bash
docker compose exec -T -u postgres tg-vault pg_dump -h /run/postgresql -d tgvault > tgvault.sql
```

升级前保留完整备份；镜像固定 PostgreSQL 主版本 17，跨数据库主版本升级需要显式迁移。应用数据库迁移后也不能保证旧镜像兼容，回滚应同时恢复对应备份。
已有三容器部署的数据不会自动迁入；应先备份数据库与文件，恢复到新卷后再切换。旧版 `deploy/install.sh` 和备份脚本针对分体服务，新部署按本文操作。

## 本地构建验证

Windows 先安装并启动 Docker Desktop（Linux 容器模式）；Linux 安装 Docker Engine。从项目根目录执行以下命令即可本地体验：

```bash
docker compose -f compose.local.yaml up -d --build
```

打开 `http://localhost:8080`，首次启动会自动初始化数据库。此本地配置只监听本机，数据保存在 `tg-vault-local_vault-data` 卷中。查看日志用 `docker compose -f compose.local.yaml logs -f`，停止用 `docker compose -f compose.local.yaml stop`，下次启动用 `docker compose -f compose.local.yaml up -d`。

需要执行容器集成测试时，在有 Docker 和 Bash 的 Linux 环境中运行：

```bash
docker build -t tg-vault:test .
bash deploy/test-all-in-one.sh
```

测试使用临时容器和临时卷，验证数据库初始化、网页与 API 路由、拒绝跨站写请求、重新创建容器后的数据保留，以及数据库退出时整个容器退出。
