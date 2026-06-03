import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CacheStore } from "../cache/cache.js";
import type { CardService } from "../cards/card-service.js";
import type { Store } from "../db/store.js";
import type { DestinyService } from "../destiny/destiny-service.js";
import { parseCount, parseId, parseMembershipType, parsePage } from "../destiny/validators.js";
import { BadRequestError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { ok } from "../lib/response.js";

export interface D2RouteDeps {
  destinyService: DestinyService;
  cardService: CardService;
  cache: CacheStore;
  store: Store;
  cardCacheTtlSeconds: number;
}

type Query = Record<string, unknown>;
type Params = Record<string, unknown>;

export async function registerD2Routes(app: FastifyInstance, deps: D2RouteDeps): Promise<void> {
  app.get("/api/d2/search", async (request) => {
    const started = Date.now();
    const query = request.query as Query;
    const data = await deps.destinyService.searchPlayer(getRequiredQueryString(query, "bungieName"));
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/profile/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getProfile(membershipType, membershipId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/summary/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const data = await deps.destinyService.getSummary(membershipType, membershipId, query.mode);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/activities/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const count = parseCount(query.count);
    const page = parsePage(query.page);
    const data = await deps.destinyService.getActivities(membershipType, membershipId, query.mode, count, page);
    await recordQuery(deps.store, request, false);
    return ok(data, { count, page, tookMs: Date.now() - started });
  });

  app.get("/api/d2/pgcr/:activityId", async (request) => {
    const started = Date.now();
    const activityId = parseId((request.params as Params).activityId, "activityId");
    const data = await deps.destinyService.getPgcr(activityId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/weapons/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getWeapons(membershipType, membershipId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/cards/summary.png", async (request, reply) => {
    const query = request.query as Query;
    const bungieName = getRequiredQueryString(query, "bungieName");
    const mode = typeof query.mode === "string" ? query.mode : "all";
    const cacheKey = `d2:card:summary:${bungieName.toLowerCase()}:${mode}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const player = await deps.destinyService.searchPlayer(bungieName);
      const summary = await deps.destinyService.getSummary(player.membershipType, player.membershipId, mode);
      return deps.cardService.renderSummaryCard(player, summary);
    });
  });

  app.get("/api/d2/cards/activity.png", async (request, reply) => {
    const query = request.query as Query;
    const activityId = getRequiredQueryString(query, "activityId");
    const cacheKey = `d2:card:activity:${activityId}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const pgcr = await deps.destinyService.getPgcr(activityId);
      return deps.cardService.renderActivityCard(pgcr);
    });
  });
}

function parseMembershipParams(params: Params): { membershipType: number; membershipId: string } {
  return {
    membershipType: parseMembershipType(params.membershipType),
    membershipId: parseId(params.membershipId, "membershipId")
  };
}

function getRequiredQueryString(query: Query, key: string): string {
  const value = query[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${key} is required`);
  }
  return value.trim();
}

async function sendCachedPng(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: D2RouteDeps,
  cacheKey: string,
  render: () => Promise<Buffer>
): Promise<void> {
  const cached = await deps.cache.getBuffer(cacheKey);
  if (cached) {
    await recordQuery(deps.store, request, true);
    reply.header("Content-Type", "image/png").send(cached);
    return;
  }

  const png = await render();
  await deps.cache.setBuffer(cacheKey, png, deps.cardCacheTtlSeconds);
  await recordQuery(deps.store, request, false);
  reply.header("Content-Type", "image/png").send(png);
}

async function recordQuery(store: Store, request: FastifyRequest, cacheHit: boolean): Promise<void> {
  try {
    await store.logQuery(request.routeOptions.url ?? request.url, cacheHit, sha256Hex(request.ip));
  } catch {
    return;
  }
}
