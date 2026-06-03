# 命运2公开战绩后台

TypeScript + Fastify 实现的 Destiny 2 公开战绩查询 API，适合部署在 Ubuntu 服务器上。调用者不需要登录或提供 key；服务端需要配置 Bungie 官方要求的 `BUNGIE_API_KEY`。

## 功能

- BungieName 查询：`Name#1234` -> `membershipType` / `membershipId`
- 公开 Profile、角色、累计战绩、近期活动、PGCR 单局详情、武器使用统计
- 总览卡片和单局卡片 PNG 输出
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

管理后台默认未启用。生成密码哈希后写入 `.env`：

```bash
npm run admin:hash -- "your-password"
```

然后配置：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt$...
ADMIN_SESSION_SECRET=replace-with-a-long-random-session-secret
```

## 公开接口

- `GET /health`
- `GET /api/d2/search?bungieName=Name%231234`
- `GET /api/d2/profile/:membershipType/:membershipId`
- `GET /api/d2/summary/:membershipType/:membershipId?mode=all|raid|dungeon|trials|pvp|gambit`
- `GET /api/d2/activities/:membershipType/:membershipId?mode=raid&count=10&page=0`
- `GET /api/d2/pgcr/:activityId`
- `GET /api/d2/weapons/:membershipType/:membershipId`
- `GET /api/d2/cards/summary.png?bungieName=Name%231234&mode=raid`
- `GET /api/d2/cards/activity.png?activityId=...`

JSON 响应统一为：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

## 测试

```bash
npm test
npm run typecheck
npm run check
```
