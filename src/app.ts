import staticPlugin from "@fastify/static";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { isAdminEnabled, toAdminAuthConfig } from "./admin/auth.js";
import { MemoryCacheStore, type CacheStore } from "./cache/cache.js";
import { RedisCacheStore } from "./cache/redis-cache.js";
import { CardService } from "./cards/card-service.js";
import { NullStore, type Store } from "./db/store.js";
import { PostgresStore } from "./db/postgres-store.js";
import { BungieClient } from "./destiny/bungie-client.js";
import { DestinyService } from "./destiny/destiny-service.js";
import { ManifestService } from "./destiny/manifest-service.js";
import { toAppError } from "./lib/errors.js";
import { fail } from "./lib/response.js";
import { QqOAuthService } from "./oauth/qq-oauth-service.js";
import { registerBungieProxyRoutes } from "./routes/bungie-proxy-routes.js";
import { registerD2Routes } from "./routes/d2-routes.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerShareRoutes } from "./routes/share-routes.js";

export interface AppDeps {
  config?: AppConfig;
  cache?: CacheStore;
  store?: Store;
  bungieClient?: BungieClient;
  manifestService?: ManifestService;
  destinyService?: DestinyService;
  cardService?: CardService;
  qqOAuthService?: QqOAuthService;
}

export async function buildApp(overrides: AppDeps = {}): Promise<FastifyInstance> {
  const config = overrides.config ?? loadConfig();
  const startedAt = Date.now();
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : true
  });

  const cache = overrides.cache ?? createCache(config);
  const store = overrides.store ?? createStore(config);
  const bungieClient = overrides.bungieClient ?? new BungieClient(config);
  const manifestService = overrides.manifestService ?? new ManifestService(bungieClient, store, config);
  const destinyService =
    overrides.destinyService ?? new DestinyService(bungieClient, cache, store, manifestService);
  const cardService = overrides.cardService ?? new CardService();
  const qqOAuthService = overrides.qqOAuthService ?? new QqOAuthService(config, cache, store, bungieClient);

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW
  });

  app.setErrorHandler((error, _request, reply) => {
    const appError = toAppError(error);
    reply.status(appError.statusCode).send(fail(appError.code, appError.message, appError.details));
  });

  app.addHook("onReady", async () => {
    if (config.NODE_ENV === "test") {
      return;
    }

    try {
      await manifestService.refresh({ preload: config.MANIFEST_PRELOAD });
      app.log.info("Destiny manifest checked");
    } catch (error) {
      app.log.warn({ error }, "Destiny manifest refresh failed");
    }
  });

  app.addHook("onClose", async () => {
    await Promise.allSettled([cache.close(), store.close()]);
  });

  await registerHealthRoutes(app);
  await registerShareRoutes(app, config);
  await registerAdminRoutes(app, {
    config,
    cache,
    store,
    bungieClient,
    destinyService,
    manifestService,
    startedAt
  });
  await registerAdminFrontend(app, config);
  await registerD2Routes(app, {
    destinyService,
    cardService,
    cache,
    store,
    qqOAuthService,
    cardCacheTtlSeconds: config.CARD_CACHE_TTL_SECONDS
  });
  await registerBungieProxyRoutes(app, {
    bungieClient,
    store
  });

  return app;
}

async function registerAdminFrontend(app: FastifyInstance, config: AppConfig): Promise<void> {
  const authConfig = toAdminAuthConfig(config);
  const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "admin");

  if (!isAdminEnabled(authConfig)) {
    app.get("/admin", async (_request, reply) => {
      reply.type("text/html; charset=utf-8").send(disabledAdminHtml());
    });
    app.get("/admin/*", async (_request, reply) => {
      reply.type("text/html; charset=utf-8").send(disabledAdminHtml());
    });
    return;
  }

  if (!existsSync(path.join(adminRoot, "index.html"))) {
    app.get("/admin", async (_request, reply) => {
      reply.type("text/html; charset=utf-8").send(missingAdminHtml());
    });
    app.get("/admin/*", async (_request, reply) => {
      reply.type("text/html; charset=utf-8").send(missingAdminHtml());
    });
    return;
  }

  await app.register(staticPlugin, {
    root: adminRoot,
    prefix: "/admin/"
  });

  app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
}

function disabledAdminHtml(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>管理后台未启用</title><body style="font-family: sans-serif; padding: 40px;"><h1>管理后台未启用</h1><p>请配置 ADMIN_PASSWORD_HASH 和 ADMIN_SESSION_SECRET 后重启服务。</p></body></html>`;
}

function missingAdminHtml(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>管理后台未构建</title><body style="font-family: sans-serif; padding: 40px;"><h1>管理后台未构建</h1><p>请运行 npm run build 生成 dist/admin。</p></body></html>`;
}

function createCache(config: AppConfig): CacheStore {
  if (config.NODE_ENV === "test") {
    return new MemoryCacheStore();
  }
  return new RedisCacheStore(config.REDIS_URL);
}

function createStore(config: AppConfig): Store {
  if (config.NODE_ENV === "test") {
    return new NullStore();
  }
  return new PostgresStore(config.DATABASE_URL);
}
