# TG Vault（NAS 单容器版）

TG Vault 是一个 Telegram 文件转存、频道媒体下载和多存储管理工具。本分支将 React 前端、Node.js 后端、PostgreSQL 17、FFmpeg 和图片处理依赖打包到一个 Docker 镜像，适合群晖、威联通、飞牛等 NAS。

- GitHub：<https://github.com/sunqiangzhong/tg_value>
- Docker Hub：<https://hub.docker.com/r/sunqz/tg-vault>
- 镜像：`sunqz/tg-vault:latest`
- 架构：优先发布 `linux/amd64`，工作流同时构建 `linux/arm64`
- Web 端口：容器内 `51947`
- 持久数据：容器内 `/data`

## 主要功能

- Telegram Bot 接收文件并自动归档
- Telegram 用户账号下载器：频道/群组扫描、订阅同步、大文件和视频下载
- 本地、OneDrive、Google Drive、阿里云 OSS、S3 兼容存储和 WebDAV
- Web 文件管理、分片上传、预览、删除、任务管理和存储切换
- 管理员密码、HttpOnly Cookie、Origin 校验、Telegram PIN 和 TOTP
- 单容器内置 PostgreSQL，NAS 无需另外部署数据库
- GitHub Actions 自动测试并发布 Docker Hub 镜像

## NAS 快速部署

新建目录并保存以下 `compose.yml`：

```yaml
services:
  tg-vault:
    image: sunqz/tg-vault:latest
    platform: linux/amd64
    container_name: tg-vault
    pull_policy: always
    ports:
      - "8080:51947"
    environment:
      TZ: "Asia/Shanghai"
      COOKIE_SECURE: "false"
      TRUST_PROXY: "loopback"
      UPDATE_CHECK_ENABLED: "false"
      CORS_ORIGIN: ""
      OAUTH_CALLBACK_BASE_URL: ""
      OAUTH_FRONTEND_ORIGIN: ""
      PROXY_HOST: ""
    volumes:
      - tg-vault-data:/data
    restart: unless-stopped
    stop_grace_period: 60s
    shm_size: 128mb

volumes:
  tg-vault-data:
```

启动并访问 `http://NAS的IP:8080`：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

首次打开时创建管理员账号，再到“设置 → Telegram”填写 Bot Token、API ID、API Hash 和 4 位 Bot PIN。ARM64 NAS 应删除 `platform`，或将其改成 `linux/arm64`。

完整模板见 [`deploy/nas/compose.yaml`](deploy/nas/compose.yaml) 和 [`deploy/nas/env.example`](deploy/nas/env.example)。

## 容器使用代理

如果 Clash/Mihomo 地址是 `192.168.5.199:7890`，先开启“允许局域网连接”，确认 mixed 端口监听局域网，然后设置：

```yaml
environment:
  PROXY_HOST: "192.168.5.199:7890"
```

重新创建容器：

```bash
docker compose up -d --force-recreate
docker compose logs --tail=100
```

`PROXY_HOST` 会同时配置 HTTP/HTTPS 和 Telegram MTProto。Telegram Bot、用户账号登录、频道扫描，以及文件和视频分片下载都会走代理；容器内部健康检查和数据库连接不会走代理。

如果 HTTP 与 SOCKS 端口不同，可以分别覆盖：

```yaml
environment:
  HTTP_PROXY: "http://192.168.5.199:7890"
  HTTPS_PROXY: "http://192.168.5.199:7890"
  TELEGRAM_PROXY_URL: "socks5://192.168.5.199:7891"
  NO_PROXY: "localhost,127.0.0.1,::1"
  NODE_USE_ENV_PROXY: "1"
```

“安全测试”只访问 Telegram HTTPS Bot API；“保存并启用”还会建立 MTProto 长连接。受限网络未配置 SOCKS 代理时，可能出现安全测试通过但启动超时。

## HTTPS 反向代理

将反向代理上游指向 `NAS_IP:8080`，并配置：

```yaml
environment:
  CORS_ORIGIN: "https://vault.example.com"
  OAUTH_CALLBACK_BASE_URL: "https://vault.example.com"
  OAUTH_FRONTEND_ORIGIN: "https://vault.example.com"
  COOKIE_SECURE: "true"
  TRUST_PROXY: "反向代理的IP或可信子网"
```

代理需要保留 `Host` 并传递 `X-Forwarded-Proto`。这些地址不带末尾 `/`；云盘 OAuth 也使用该公网地址配置回调。

## 更新、日志和备份

```bash
docker compose pull
docker compose up -d
docker compose logs --tail=100
```

排查状态和代理变量：

```bash
docker compose ps
docker compose logs -f
docker exec tg-vault env | grep -i proxy
```

数据库、文件、缩略图、Telegram 会话和加密密钥都在 `tg-vault-data` 卷中。不要执行 `docker compose down -v`，否则会删除数据。

数据库逻辑备份：

```bash
docker compose exec -T -u postgres tg-vault \
  pg_dump -h /run/postgresql -d tgvault > tgvault.sql
```

完整卷备份前先执行 `docker compose stop`，完成后执行 `docker compose start`。

## 本地启动和验证

Windows 需要启动 Docker Desktop 并使用 Linux 容器。在项目根目录运行：

```bash
docker compose -f compose.local.yaml up -d --build
```

访问 <http://localhost:8080>。查看日志和停止：

```bash
docker compose -f compose.local.yaml logs -f
docker compose -f compose.local.yaml stop
```

构建单容器镜像：

```bash
docker build -t tg-vault:test .
```

### 原项目的源码分体部署

仓库仍保留 `docker-compose.yml` 和 `deploy/install.sh`，供需要分别运行前端、后端与数据库的开发或生产环境使用。安装向导对新手只需填写（2 项）：前端公网地址和后端 API 公网地址，其余 OAuth 地址会自动推导。

Telegram Bot Token、API ID、API Hash、Bot PIN 和用户账号登录信息应在 Web 的“设置 → Telegram”中配置，不要把这些内容写入 `.env`。本 README 开头的 NAS 单容器方案不需要运行该安装向导。

## 修改后推送并发布镜像

工作流位于 [`.github/workflows/docker-all-in-one.yml`](.github/workflows/docker-all-in-one.yml)。首次使用前，在 GitHub 的 **Settings → Secrets and variables → Actions** 添加：

- `DOCKER_USERNAME`：Docker Hub 用户名，例如 `sunqz`
- `DOCKER_PASSWORD`：有 Read & Write 权限的 Docker Hub Access Token

工作流监听 `docker-hub` 分支。修改完成后运行：

```bash
git switch docker-hub
git status
git add -A
git commit -m "描述本次修改"
git push origin docker-hub
```

随后在 GitHub **Actions** 页面查看 `Publish single-container NAS image`：

1. `verify` 执行前后端测试、类型检查和构建。
2. `build (amd64)` 构建并测试真实 x86 容器。
3. `build (arm64)` 尝试构建 ARM64；ARM 故障不会阻断 x86 发布。
4. `publish` 更新 `latest`、`docker-hub` 和提交 SHA 标签。

发布成功后，NAS 执行：

```bash
docker compose pull
docker compose up -d
```

需要重新发布当前提交时，在 Actions 页面选择 `docker-hub` 分支并点击 **Run workflow**。

## Telegram 配置来源

- Bot Token：[Telegram @BotFather](https://t.me/BotFather)
- API ID、API Hash：[my.telegram.org](https://my.telegram.org) 的 API development tools
- Bot 凭证和用户账号登录信息在 Web “设置 → Telegram”中管理并加密保存
- 频道抓取、订阅同步和大视频下载需要登录 Telegram 用户账号下载器

## 目录结构

```text
backend/                         Node.js API、Telegram 与存储服务
frontend/                        React Web 管理界面
deploy/all-in-one-entrypoint.sh  单容器启动与代理初始化
deploy/nas/                      NAS Compose、环境变量和详细说明
.github/workflows/               自动测试与 Docker Hub 发布
Dockerfile                       单容器镜像
compose.local.yaml               本地 Docker Desktop 验证
```

## License

许可证见 [LICENSE](LICENSE)。
