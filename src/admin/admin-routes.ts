import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { CacheStore } from "../cache/cache.js";
import type { Store } from "../db/store.js";
import type { BungieClient, BungieHttpMethod } from "../destiny/bungie-client.js";
import type { DestinyService } from "../destiny/destiny-service.js";
import type { ManifestService } from "../destiny/manifest-service.js";
import { parseQq } from "../bindings/qq.js";
import { parseMembershipType, parseId } from "../destiny/validators.js";
import { BadRequestError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { ok } from "../lib/response.js";
import { normalizePlatformPath, parseQuery as parseBungieProxyQuery } from "../routes/bungie-proxy-routes.js";
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
  bungieClient: BungieClient;
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

  app.get("/api/admin/bindings/qq", async (request) => {
    requireAdminSession(request, authConfig);
    const query = request.query as Query;
    const q = typeof query.q === "string" && query.q.length > 0 ? query.q : undefined;
    return ok(await deps.store.listQqBindings(q, parsePageOptions(query)));
  });

  app.post("/api/admin/bindings/qq", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const binding = await resolveAdminQqBindingInput(request.body, deps.destinyService);
    const saved = await deps.store.upsertQqBinding(binding);
    await audit(deps.store, request, session.username, "qq.bind.upsert", binding.qq, {
      membershipType: binding.membershipType,
      membershipId: binding.membershipId
    });
    return ok(saved);
  });

  app.delete("/api/admin/bindings/qq/:qq", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const qq = parseQq((request.params as Params).qq);
    const deleted = await deps.store.deleteQqBinding(qq);
    await audit(deps.store, request, session.username, "qq.bind.delete", qq, { deleted });
    return ok({ qq, deleted });
  });

  app.delete("/api/admin/bindings/qq/:qq/oauth", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const qq = parseQq((request.params as Params).qq);
    const revoked = await deps.store.revokeQqOAuthToken(qq);
    await audit(deps.store, request, session.username, "qq.oauth.revoke", qq, { revoked });
    return ok({ qq, revoked });
  });

  app.post("/api/admin/d2/query", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const parsed = parseAdminD2Query(request.body);
    const started = Date.now();
    const response = await app.inject({
      method: parsed.method,
      url: parsed.url
    });
    const tookMs = Date.now() - started;
    const contentType = headerValue(response.headers["content-type"]);
    const isImage = contentType.toLowerCase().startsWith("image/png");

    await audit(deps.store, request, session.username, "admin.d2.query", parsed.url, {
      statusCode: response.statusCode,
      contentType,
      tookMs
    });

    if (isImage) {
      return ok({
        kind: "image",
        method: parsed.method,
        url: parsed.url,
        statusCode: response.statusCode,
        contentType,
        bytes: response.rawPayload.length,
        base64: response.rawPayload.toString("base64"),
        tookMs
      });
    }

    return ok({
      kind: "json",
      method: parsed.method,
      url: parsed.url,
      statusCode: response.statusCode,
      contentType,
      body: parseResponseBody(response.body),
      tookMs
    });
  });

  app.post("/api/admin/bungie/query", async (request) => {
    const session = requireAdminSession(request, authConfig);
    const parsed = parseAdminBungieProxyRequest(request.body);
    const started = Date.now();
    const response = await deps.bungieClient.rawRequest(parsed.method, parsed.path, {
      query: parsed.query,
      body: parsed.body,
      headers: parsed.headers
    });
    const tookMs = Date.now() - started;

    await audit(deps.store, request, session.username, "admin.bungie.query", `${parsed.method} ${parsed.path}`, {
      statusCode: response.statusCode,
      contentType: response.contentType,
      tookMs,
      hasBody: parsed.body !== undefined,
      usesOAuth: parsed.usesOAuth
    });

    return ok({
      kind: "bungie",
      method: parsed.method,
      path: parsed.path,
      statusCode: response.statusCode,
      statusText: response.statusText,
      contentType: response.contentType,
      headers: response.headers,
      body: response.body,
      tookMs
    });
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

function parseCacheScope(value: unknown): "player" | "summary" | "activities" | "pgcr" | "weapons" | "craftables" | "all" {
  const scope = typeof value === "string" ? value : "all";
  if (["player", "summary", "activities", "pgcr", "weapons", "craftables", "all"].includes(scope)) {
    return scope as "player" | "summary" | "activities" | "pgcr" | "weapons" | "craftables" | "all";
  }
  throw new BadRequestError("Unsupported cache scope");
}

async function clearPlayerCache(cache: CacheStore, membershipType: number, membershipId: string): Promise<number> {
  const prefixes = [
    `d2:profile:${membershipType}:${membershipId}`,
    `d2:summary:${membershipType}:${membershipId}`,
    `d2:activities:${membershipType}:${membershipId}`,
    `d2:career:${membershipType}:${membershipId}`,
    `d2:pvp-overview:${membershipType}:${membershipId}`,
    `d2:activity-overview:dungeon:${membershipType}:${membershipId}`,
    `d2:heatmap:${membershipType}:${membershipId}`,
    `d2:namecard:${membershipType}:${membershipId}`,
    `d2:weapons:${membershipType}:${membershipId}`,
    `d2:craftables:${membershipType}:${membershipId}`
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

function parseAdminD2Query(body: unknown): { method: "GET"; path: string; url: string } {
  if (!isRecord(body)) {
    throw new BadRequestError("Request body must be an object");
  }

  const method = typeof body.method === "string" ? body.method.toUpperCase() : "GET";
  if (method !== "GET") {
    throw new BadRequestError("Only GET is supported");
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (path.length === 0) {
    throw new BadRequestError("path is required");
  }
  if (path.includes("://") || path.startsWith("//")) {
    throw new BadRequestError("Full URLs are not allowed");
  }
  if (path.includes("?")) {
    throw new BadRequestError("Put query parameters in the query object");
  }
  if (!isAllowedD2Path(path)) {
    throw new BadRequestError("Path is not allowed");
  }

  const queryString = serializeQuery(body.query);
  return {
    method: "GET",
    path,
    url: queryString.length > 0 ? `${path}?${queryString}` : path
  };
}

function parseAdminBungieProxyRequest(body: unknown): {
  method: BungieHttpMethod;
  path: string;
  query: Record<string, string | number | boolean | Array<string | number>>;
  body?: unknown;
  headers?: Record<string, string>;
  usesOAuth: boolean;
} {
  if (!isRecord(body)) {
    throw new BadRequestError("Request body must be an object");
  }

  const method = parseBungieProxyMethod(body.method);
  const path = normalizePlatformPath(body.path);
  const requestBody = body.body;
  if ((method === "GET" || method === "DELETE") && requestBody !== undefined) {
    throw new BadRequestError(`${method} requests must not include body`);
  }

  const oauthAccessToken = typeof body.oauthAccessToken === "string" ? body.oauthAccessToken.trim() : "";
  return {
    method,
    path,
    query: parseBungieProxyQuery(body.query),
    body: requestBody,
    headers: oauthAccessToken.length > 0 ? { Authorization: `Bearer ${oauthAccessToken}` } : undefined,
    usesOAuth: oauthAccessToken.length > 0
  };
}

function parseBungieProxyMethod(value: unknown): BungieHttpMethod {
  const method = typeof value === "string" ? value.toUpperCase() : "GET";
  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return method as BungieHttpMethod;
  }
  throw new BadRequestError("Unsupported Bungie API method");
}

function isAllowedD2Path(path: string): boolean {
  return [
    /^\/api\/d2\/search$/,
    /^\/api\/d2\/profile\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/summary\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/career\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/pvp\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/raids\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/dungeons\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/grandmasters\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/activities\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/heatmap\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/namecard\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/pgcr\/[^/?#]+$/,
    /^\/api\/d2\/weapons\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/craftables\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/vault\/[^/?#]+\/[^/?#]+\/search$/,
    /^\/api\/d2\/inventory\/[^/?#]+\/[^/?#]+\/weapons$/,
    /^\/api\/d2\/inventory\/qq\/[^/?#]+$/,
    /^\/api\/d2\/inventory\/qq\/[^/?#]+\/search$/,
    /^\/api\/d2\/loadouts\/qq\/[^/?#]+$/,
    /^\/api\/d2\/catalysts\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/catalysts\/qq\/[^/?#]+$/,
    /^\/api\/d2\/titles\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/skins\/[^/?#]+\/[^/?#]+$/,
    /^\/api\/d2\/cards\/summary\.png$/,
    /^\/api\/d2\/cards\/profile\.png$/,
    /^\/api\/d2\/cards\/weapons\.png$/,
    /^\/api\/d2\/cards\/raids\.png$/,
    /^\/api\/d2\/cards\/latest-activity\.png$/,
    /^\/api\/d2\/cards\/activity\.png$/
  ].some((pattern) => pattern.test(path));
}

function serializeQuery(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (!isRecord(value)) {
    throw new BadRequestError("query must be an object");
  }

  const search = new URLSearchParams();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        appendQueryValue(search, key, item);
      }
      continue;
    }
    appendQueryValue(search, key, entry);
  }
  return search.toString();
}

function appendQueryValue(search: URLSearchParams, key: string, value: unknown): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    search.append(key, String(value));
    return;
  }
  throw new BadRequestError("query values must be strings, numbers, booleans, or arrays of those values");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function parseResponseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function resolveAdminQqBindingInput(
  body: unknown,
  destinyService: DestinyService
): Promise<{
  qq: string;
  membershipType: number;
  membershipId: string;
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
  notes?: string;
}> {
  if (!isRecord(body)) {
    throw new BadRequestError("Request body must be an object");
  }

  const qq = parseQq(body.qq);
  const notes = typeof body.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : undefined;

  if (typeof body.bungieName === "string" && body.bungieName.trim().length > 0) {
    const player = await destinyService.searchPlayer(body.bungieName.trim());
    return {
      qq,
      membershipType: player.membershipType,
      membershipId: player.membershipId,
      bungieName: player.bungieName,
      displayName: player.displayName,
      displayNameCode: player.displayNameCode,
      notes
    };
  }

  if (body.membershipType !== undefined && body.membershipId !== undefined) {
    return {
      qq,
      membershipType: parseMembershipType(body.membershipType),
      membershipId: parseId(body.membershipId, "membershipId"),
      notes
    };
  }

  throw new BadRequestError("Provide either bungieName or membershipType and membershipId");
}
