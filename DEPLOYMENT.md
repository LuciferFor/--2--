# Ubuntu 部署说明

当前生产部署路径：

- 服务器：`192.168.31.11`
- 部署用户：`d2stats`
- 应用目录：`/opt/destiny2-public-stats/app`
- Compose 项目名：`destiny2-public-stats`
- 宿主访问端口：`3011`
- 容器内监听端口：`3000`

## 常用命令

```bash
cd /opt/destiny2-public-stats/app
sudo docker compose -p destiny2-public-stats ps
sudo docker compose -p destiny2-public-stats logs -f app
sudo docker compose -p destiny2-public-stats --env-file .env up -d --build app
sudo docker compose -p destiny2-public-stats --env-file .env run --rm app npm run migrate
```

## 配置

真实 Bungie API Key 只放在服务器 `.env`：

```bash
sudo nano /opt/destiny2-public-stats/app/.env
```

修改 `BUNGIE_API_KEY` 后重启：

```bash
cd /opt/destiny2-public-stats/app
sudo docker compose -p destiny2-public-stats --env-file .env up -d app
```

## 管理后台

管理后台地址是 `http://192.168.31.11:3011/admin`。默认未启用，需要在服务器生成密码哈希并写入 `.env`：

```bash
cd /opt/destiny2-public-stats/app
sudo docker compose -p destiny2-public-stats --env-file .env run --rm app npm run admin:hash -- "your-password"
sudo nano /opt/destiny2-public-stats/app/.env
sudo docker compose -p destiny2-public-stats --env-file .env up -d --build app
```

需要配置的变量：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt$...
ADMIN_SESSION_SECRET=generated-secret
```

已有数据库升级后执行一次迁移，创建后台审计日志表和查询索引：

```bash
cd /opt/destiny2-public-stats/app
sudo docker compose -p destiny2-public-stats --env-file .env run --rm app npm run migrate
```
