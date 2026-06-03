import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { CacheStore } from "../cache/cache.js";
import type { Store } from "../db/store.js";
import type { DestinyService } from "../destiny/destiny-service.js";
import type { ManifestService } from "../destiny/manifest-service.js";
import { parseMembershipType, parseId } from "../destiny/validators.js";
import { BadRequestError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { ok } from "../lib/response.js";
import {
  clearSessionCookie,
  createSessionCookie,
  readSession,
  requireAdminEnabled,
  requireAdminSession,
  setSessionCookie,
  toAdminAuthConfig,
  verifyPassword
} from "./auth.js";

export interface AdminRouteDeps {
  config: AppConfig;
  cache: CacheStore;
  store: Store;
  destinyService: DestinyService;
  manifestService: ManifestService;
  startedAt: number;
}

type Query = Record<string, unknown>;
type Params = Record<string, unknown>;

export async function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): Promise<void> {
  const authConfig = toAdminAuthConfig(deps.config);

  app.post("/api/admin/auth/login", async (request, reply) => {
    requireAdminEnabled(authConfig);
    const body = request.body as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username !== authConfig.username || !verifyPassword(password, authConfig.passwordHash)) {
      throw new BadRequestError("Invalid admin credentials");
    }

    const cookie = createSessionCookie(username, authConfig);
    setSessionCookie(reply, cookie, authConfig.sessionTtlSeconds);
    await audit(deps.store, request, username, "login");
    return ok({ username });
  });

  app.post("/api/admin/auth/logout", async (request, reply) => {
    requireAdminEnabled(authConfig);
    const session = readSession(request, authConfig);
    clearSessionCookie(reply);
    if (session) {
      await audit(deps.store, request, session.username, "logout");
    }
    return ok({ loggedOut: true });
  });

  app.get("/api/admin/auth/me", async (request) => {
    const session = requireAdminSession(request, authConfig);
    return ok({
      username: session.username,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
  });

  app.get("/api/admin/overview", async (request) => {
    requireAdminSession(request, authConfig);
    const [redisOk, postgresOk, manifest] = await Promise.all([
      deps.cache.ping().catch(() => false),
      deps.store.ping().catch(() => false),
      deps.store.getManifestStatus().catch(() => ({ versions: [] }))
    ]);

    return ok({
      service: {
        status: "ok",
        uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
        nodeEnv: deps.config.NODE_ENV
      },
      dependencies: {
        redis: redisOk ? "ok" : "error",
        postgres: postgresOk ? "ok" : "error"
      },
      manifest,
      admin: {
        enabled: true,
        username: authConfig.username
      }
    });
  });

  app.get("/api/admin/metrics", async (request) => {
    requireAdminSession(request, authConfig);
    const query = request.query as Query;
    return ok(
      await deps.store.getMetrics({
        from: parseOptionalDate(query.from),
        to: parseOptionalDate(query.to),
        interval: query.interval === "day" ? "day" : "hour"
      })
    );
  });

  app.get("/api/admin/queries", async (request) => {
    requireAdminSession(request, authConfig);
    const query = request.query as Query;
    return ok(
      await deps.store.listQueryLogs(
        {
          route: typeof query.route === "string" && query.route.length > 0 ? query.route : undefined,
          cacheHit: parseOptionalBoolean(query.cacheHit)
        },
        parsePageOptions(query)
      )
    );
  });

  app.get("/api/admin/players", async (request) => {
    requireAdminSession(request, authConfig);
    const query = request.query as Query;
    const q = typeof query.q === "string" && query.q.length > 0 ? query.q : undefined;
    return ok(await deps.store.listPlayers(q, parsePageOptions(query)));
  });

  app.post("/api/admin/players/:membershipType/:membershipId/refresh", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const deleted = await clearPlayerCache(deps.cache, membershipType, membershipId);
    const profile = await deps.destinyService.getProfile(membershipType, membershipId);
    await audit(deps.store, request, session.username, "player.refresh", `${membershipType}:${membershipId}`, { deleted });
    return ok({ deleted, profile });
  });

  app.delete("/api/admin/cache", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const query = request.query as Query;
    const scope = parseCacheScope(query.scope);
    const deleted = await clearCacheByScope(deps.cache, scope);
    await audit(deps.store, request, session.username, "cache.clear", scope, { deleted });
    return ok({ scope, deleted });
  });

  app.post("/api/admin/manifest/refresh", async (request) => {
    const session = requireAdminSession(request, authConfig);
    await deps.manifestService.refresh({ preload: deps.config.MANIFEST_PRELOAD });
    await audit(deps.store, request, session.username, "manifest.refresh", deps.config.MANIFEST_LOCALE);
    return ok(await deps.store.getManifestStatus());
  });

  app.get("/api/admin/audit", async (request) => {
    requireAdminSession(request, authConfig);
    return ok(await deps.store.listAdminAuditLogs(parsePageOptions(request.query as Query)));
  });

  app.get("/api/admin/config", async (request) => {
    requireAdminSession(request, authConfig);
    return ok({
      nodeEnv: deps.config.NODE_ENV,
      host: deps.config.HOST,
      port: deps.config.PORT,
      corsOrigin: deps.config.CORS_ORIGIN,
      rateLimitMax: deps.config.RATE_LIMIT_MAX,
      rateLimitWindow: deps.config.RATE_LIMIT_WINDOW,
      manifestLocale: deps.config.MANIFEST_LOCALE,
      manifestPreload: deps.config.MANIFEST_PRELOAD,
      adminUsername: deps.config.ADMIN_USERNAME,
      bungieApiKeyConfigured: deps.config.BUNGIE_API_KEY.length > 0,
      databaseConfigured: deps.config.DATABASE_URL.length > 0,
      redisConfigured: deps.config.REDIS_URL.length > 0
    });
  });
}

function parseMembershipParams(params: Params): { membershipType: number; membershipId: string } {
  return {
    membershipType: parseMembershipType(params.membershipType),
    membershipId: parseId(params.membershipId, "membershipId")
  };
}

function parsePageOptions(query: Query): { page: number; pageSize: number } {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1) {
    throw new BadRequestError("page must be a positive integer");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BadRequestError("pageSize must be between 1 and 100");
  }
  return { page, pageSize };
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError("Invalid date");
  }
  return date;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new BadRequestError("cacheHit must be true or false");
}

function parseCacheScope(value: unknown): "player" | "summary" | "activities" | "pgcr" | "weapons" | "all" {
  const scope = typeof value === "string" ? value : "all";
  if (["player", "summary", "activities", "pgcr", "weapons", "all"].includes(scope)) {
    return scope as "player" | "summary" | "activities" | "pgcr" | "weapons" | "all";
  }
  throw new BadRequestError("Unsupported cache scope");
}

async function clearPlayerCache(cache: CacheStore, membershipType: number, membershipId: string): Promise<number> {
  const prefixes = [
    `d2:profile:${membershipType}:${membershipId}`,
    `d2:summary:${membershipType}:${membershipId}`,
    `d2:activities:${membershipType}:${membershipId}`,
    `d2:weapons:${membershipType}:${membershipId}`
  ];
  const deleted = await Promise.all(prefixes.map((prefix) => cache.deleteByPrefix(prefix)));
  return deleted.reduce((sum, value) => sum + value, 0);
}

async function clearCacheByScope(cache: CacheStore, scope: string): Promise<number> {
  const prefixes =
    scope === "all"
      ? ["d2:"]
      : scope === "player"
        ? ["d2:search:", "d2:profile:"]
        : [`d2:${scope}:`];
  const deleted = await Promise.all(prefixes.map((prefix) => cache.deleteByPrefix(prefix)));
  return deleted.reduce((sum, value) => sum + value, 0);
}

async function audit(
  store: Store,
  request: FastifyRequest,
  actor: string,
  action: string,
  target?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await store.logAdminAudit({
    actor,
    action,
    target,
    details,
    ipHash: sha256Hex(request.ip)
  });
}
