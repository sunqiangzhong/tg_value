# NAS 单容器部署

镜像包含 React 网页、Node API、PostgreSQL 17 和 ffmpeg，只启动一个容器。
支持 `linux/amd64`（Intel/AMD x86_64）和 `linux/arm64`（64 位 ARM），不支持 ARMv7/32 位系统。

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

PR 只构建测试。手动运行 workflow 时选择 `docker-hub` 分支才会发布。
原有 `docker-publish.yml` 仍用于 main/master 的分体镜像，不发布这里的一体镜像。

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
