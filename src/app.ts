import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
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
import { registerD2Routes } from "./routes/d2-routes.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface AppDeps {
  config?: AppConfig;
  cache?: CacheStore;
  store?: Store;
  bungieClient?: BungieClient;
  manifestService?: ManifestService;
  destinyService?: DestinyService;
  cardService?: CardService;
}

export async function buildApp(overrides: AppDeps = {}): Promise<FastifyInstance> {
  const config = overrides.config ?? loadConfig();
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
  await registerD2Routes(app, {
    destinyService,
    cardService,
    cache,
    store,
    cardCacheTtlSeconds: config.CARD_CACHE_TTL_SECONDS
  });

  return app;
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
