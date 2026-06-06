# 命运2公开战绩后台

TypeScript + Fastify 实现的 Destiny 2 公开战绩查询 API，适合部署在 Ubuntu 服务器上。调用者不需要登录或提供 key；服务端需要配置 Bungie 官方要求的 `BUNGIE_API_KEY`。

## 功能

- BungieName 查询：`Name#1234` -> `membershipType` / `membershipId`
- 公开 Profile、角色、累计战绩、近期活动、PGCR 单局详情、武器使用统计
- 总览卡片和单局卡片 PNG 输出
- QQ 号可通过 Bungie OAuth 登录绑定到 Destiny membership，并加密保存授权 token
- `/admin` 管理后台：查询日志、玩家缓存、Manifest、配置只读展示和审计日志
- Redis 缓存、PostgreSQL 存储玩家解析缓存、Manifest 元数据和查询日志
- Docker Compose 一键运行 app、postgres、redis

## 本地运行

```bash
cp .env.example .env
npm install
npm run migrate
npm run dev
```

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

首次启动前把 `.env` 里的 `BUNGIE_API_KEY` 改为你的 Bungie 应用 API Key。
`PORT` 是容器内服务监听端口，`HOST_PORT` 是 Ubuntu 宿主机暴露端口；如果 3000 被占用，只改 `HOST_PORT` 即可。

如需启用 QQ OAuth 绑定，在 Bungie 应用后台使用 Confidential Client，并配置：

```env
PUBLIC_BASE_URL=https://xrx.hitokage.cn
BUNGIE_OAUTH_CLIENT_ID=45756
BUNGIE_OAUTH_CLIENT_SECRET=replace-with-client-secret
BUNGIE_OAUTH_REDIRECT_URL=https://xrx.hitokage.cn/api/d2/bindings/qq/oauth/callback
BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
QQ_BIND_OAUTH_TTL_SECONDS=180
```

Bungie 应用 scope 建议包含 `ReadDestinyInventoryAndVault` 和 `MoveEquipDestinyItems`；`ReadBasicUserProfile` 由 Bungie 默认包含。生成加密 key 可用：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

管理后台默认未启用。生成密码哈希后写入 `.env`：

```bash
npm run admin:hash -- "your-password"
```

然后配置：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt:...
ADMIN_SESSION_SECRET=replace-with-a-long-random-session-secret
```

## 公开接口

- `GET /health`
- `GET /api/d2/search?bungieName=Name%231234`
- `GET /api/d2/profile/:membershipType/:membershipId`
- `GET /api/d2/summary/:membershipType/:membershipId?mode=all|raid|dungeon|trials|pvp|gambit`
- `GET /api/d2/career/:membershipType/:membershipId`
- `GET /api/d2/pvp/:membershipType/:membershipId?count=10`
- `GET /api/d2/raids/:membershipType/:membershipId?historyPages=1&pgcrLimit=20`
- `GET /api/d2/dungeons/:membershipType/:membershipId?historyPages=1`
- `GET /api/d2/activities/:membershipType/:membershipId?mode=raid&count=10&page=0`
- `GET /api/d2/heatmap/:membershipType/:membershipId?mode=all&pages=2&timezone=Asia%2FShanghai`
- `GET /api/d2/namecard/:membershipType/:membershipId`
- `GET /api/d2/pgcr/:activityId`
- `GET /api/d2/weapons/:membershipType/:membershipId`
- `GET /api/d2/bindings/qq/:qq`
- `POST /api/d2/bindings/qq`
- `POST /api/d2/bindings/qq/oauth/start`
- `GET /api/d2/bind/:code`
- `GET /api/d2/bindings/qq/oauth/authorize?state=...`
- `GET /api/d2/bindings/qq/oauth/callback?code=...&state=...`
- `POST /api/d2/bindings/qq/oauth/confirm`

`/oauth/start` 会返回短绑定链接 `/api/d2/bind/:code` 供机器人发送；`/oauth/authorize?state=...` 只保留给旧链接兼容。
- `GET /api/d2/vault/:membershipType/:membershipId/search?q=...`：需要 OAuth，当前返回 `OAUTH_REQUIRED`
- `GET /api/d2/inventory/:membershipType/:membershipId/weapons`：需要 OAuth，当前返回 `OAUTH_REQUIRED`
- `GET /api/d2/catalysts/:membershipType/:membershipId`：需要 OAuth，当前返回 `OAUTH_REQUIRED`
- `GET /api/d2/titles/:membershipType/:membershipId`：需要 OAuth，当前返回 `OAUTH_REQUIRED`
- `GET /api/d2/skins/:membershipType/:membershipId`：需要 OAuth，当前返回 `OAUTH_REQUIRED`
- `GET /api/d2/cards/summary.png?bungieName=Name%231234&mode=raid`
- `GET /api/d2/cards/summary.png?qq=607972716&mode=raid`
- `GET /api/d2/cards/summary.png?membershipType=3&membershipId=461168...&mode=raid`
- `GET /api/d2/cards/profile.png?qq=607972716`
- `GET /api/d2/cards/weapons.png?membershipType=3&membershipId=461168...`
- `GET /api/d2/cards/latest-activity.png?qq=607972716&mode=raid`
- `GET /api/d2/cards/activity.png?activityId=...`
- `GET /api/bungie/:platformPath*`：公开只读 Bungie Platform 代理，例如 `/api/bungie/Destiny2/Manifest/`

## Bungie 全量接口代理

后台提供两种 Bungie Platform 通用代理：

- 公开只读：`GET /api/bungie/Destiny2/Manifest/`
- 管理员完整代理：`POST /api/admin/bungie/query`

公开代理只支持 `GET`，会自动带服务端 `BUNGIE_API_KEY`，适合查询 Bungie 官方所有公开 GET 接口。路径是 `https://www.bungie.net/Platform` 后面的相对路径。

管理员完整代理需要先登录后台，支持 `GET/POST/PUT/PATCH/DELETE`、query、body 和可选 OAuth access token：

```json
{
  "method": "POST",
  "path": "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
  "body": {
    "displayName": "Guardian",
    "displayNameCode": 7
  }
}
```

如果接口需要 OAuth，可传：

```json
{
  "method": "GET",
  "path": "/Destiny2/3/Profile/461168.../",
  "query": {
    "components": "100,102,200,201"
  },
  "oauthAccessToken": "..."
}
```

注意：没有 OAuth 时，Bungie 官方要求授权的私密接口仍会返回 Bungie 错误；本项目不会绕过 Bungie 权限限制。

JSON 响应统一为：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

`/api/d2/summary?mode=raid` 是 Bungie raid 模式累计统计；`/api/d2/raids/...` 才是突袭总览，会按每个 raid 返回 clears、最快通关、击杀/死亡/时长、最近通关，以及从扫描到的 PGCR 中确认 flawless/day one。`historyPages` 和 `pgcrLimit` 越大越接近完整历史，但请求更慢。

`/api/d2/dungeons/...` 和 `/api/d2/heatmap/...` 使用公开历史/聚合统计生成机器人友好的业务数据；OAuth 绑定会保存后续私有接口需要的授权 token，但仓库、私有库存、催化进度、称号/凯旋进度、皮肤拥有情况当前仍先以稳定接口返回 `OAUTH_REQUIRED`，后续可在同一路径补全真实数据。

## 测试

```bash
npm test
npm run typecheck
npm run check
```
