import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CacheStore } from "../cache/cache.js";
import type { CardService } from "../cards/card-service.js";
import type { Store } from "../db/store.js";
import type { DestinyService } from "../destiny/destiny-service.js";
import type { PlayerSearchResult } from "../destiny/destiny-types.js";
import { parseQq } from "../bindings/qq.js";
import { parseCount, parseId, parseMembershipType, parsePage } from "../destiny/validators.js";
import { BadRequestError, NotFoundError, OAuthRequiredError } from "../lib/errors.js";
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
type CardTarget = {
  membershipType: number;
  membershipId: string;
  player: PlayerSearchResult;
  cacheKey: string;
};

export async function registerD2Routes(app: FastifyInstance, deps: D2RouteDeps): Promise<void> {
  app.get("/api/d2/search", async (request) => {
    const started = Date.now();
    const query = request.query as Query;
    const data = await deps.destinyService.searchPlayer(getRequiredQueryString(query, "bungieName"));
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.post("/api/d2/bindings/qq", async (request) => {
    const started = Date.now();
    const binding = await resolveBindingInput(request.body, deps.destinyService);
    const created = await deps.store.createQqBinding(binding);
    if (!created) {
      throw new BadRequestError("qq is already bound");
    }
    await recordQuery(deps.store, request, false);
    return ok(created, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/bindings/qq/:qq", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const binding = await deps.store.getQqBinding(qq);
    if (!binding) {
      throw new NotFoundError("qq binding was not found");
    }
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok({ ...binding, lastResolvedAt: new Date().toISOString() }, { tookMs: Date.now() - started });
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

  app.get("/api/d2/career/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getCareerSummary(membershipType, membershipId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/pvp/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const count = parseBoundedInteger(query.count, "count", 1, 50, 10);
    const data = await deps.destinyService.getPvpOverview(membershipType, membershipId, count);
    await recordQuery(deps.store, request, false);
    return ok(data, { count, tookMs: Date.now() - started });
  });

  app.get("/api/d2/raids/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const data = await deps.destinyService.getRaidOverview(membershipType, membershipId, {
      historyPages: parseBoundedInteger(query.historyPages, "historyPages", 1, 10, 1),
      pgcrLimit: parseBoundedInteger(query.pgcrLimit, "pgcrLimit", 0, 200, 20)
    });
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/dungeons/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const data = await deps.destinyService.getDungeonOverview(membershipType, membershipId, {
      historyPages: parseBoundedInteger(query.historyPages, "historyPages", 1, 10, 1)
    });
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

  app.get("/api/d2/heatmap/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const data = await deps.destinyService.getHeatmap(membershipType, membershipId, query.mode, {
      pages: parseBoundedInteger(query.pages, "pages", 1, 10, 2),
      timezone: parseTimezone(query.timezone)
    });
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/namecard/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getNamecard(membershipType, membershipId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/pgcr/:activityId", async (request) => {
    const started = Date.now();
    const activityId = parseId((request.params as Params).activityId, "activityId");
    const data = await deps.destinyService.getPgcr(activityId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/vault/:membershipType/:membershipId/search", oauthRequired("Vault search"));
  app.get("/api/d2/inventory/:membershipType/:membershipId/weapons", oauthRequired("Private inventory weapons"));
  app.get("/api/d2/catalysts/:membershipType/:membershipId", oauthRequired("Catalyst progress"));
  app.get("/api/d2/titles/:membershipType/:membershipId", oauthRequired("Triumph seal and title progress"));
  app.get("/api/d2/skins/:membershipType/:membershipId", oauthRequired("Collection and ornament ownership"));

  app.get("/api/d2/weapons/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getWeapons(membershipType, membershipId);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/cards/summary.png", async (request, reply) => {
    const query = request.query as Query;
    const target = await resolveCardTarget(query, deps);
    const mode = typeof query.mode === "string" ? query.mode : "all";
    const cacheKey = `d2:card:summary:${target.cacheKey}:${mode}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const summary = await deps.destinyService.getSummary(target.membershipType, target.membershipId, mode);
      return deps.cardService.renderSummaryCard(target.player, summary);
    });
  });

  app.get("/api/d2/cards/profile.png", async (request, reply) => {
    const query = request.query as Query;
    const target = await resolveCardTarget(query, deps);
    const cacheKey = `d2:card:profile:${target.cacheKey}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const profile = await deps.destinyService.getProfile(target.membershipType, target.membershipId);
      return deps.cardService.renderProfileCard(target.player, profile);
    });
  });

  app.get("/api/d2/cards/weapons.png", async (request, reply) => {
    const query = request.query as Query;
    const target = await resolveCardTarget(query, deps);
    const cacheKey = `d2:card:weapons:${target.cacheKey}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const weapons = await deps.destinyService.getWeapons(target.membershipType, target.membershipId);
      return deps.cardService.renderWeaponsCard(target.player, weapons);
    });
  });

  app.get("/api/d2/cards/raids.png", async (request, reply) => {
    const query = request.query as Query;
    const target = await resolveCardTarget(query, deps);
    const historyPages = parseBoundedInteger(query.historyPages, "historyPages", 1, 10, 1);
    const pgcrLimit = parseBoundedInteger(query.pgcrLimit, "pgcrLimit", 0, 200, 20);
    const cacheKey = `d2:card:raids:${target.cacheKey}:${historyPages}:${pgcrLimit}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const overview = await deps.destinyService.getRaidOverview(target.membershipType, target.membershipId, {
        historyPages,
        pgcrLimit
      });
      return deps.cardService.renderRaidOverviewCard(target.player, overview);
    });
  });

  app.get("/api/d2/cards/latest-activity.png", async (request, reply) => {
    const query = request.query as Query;
    const target = await resolveCardTarget(query, deps);
    const mode = typeof query.mode === "string" ? query.mode : "all";
    const cacheKey = `d2:card:latest-activity:${target.cacheKey}:${mode}`;

    await sendCachedPng(request, reply, deps, cacheKey, async () => {
      const activities = await deps.destinyService.getActivities(target.membershipType, target.membershipId, mode, 1, 0);
      const activity = activities[0];
      if (!activity) {
        throw new NotFoundError("No recent activity was found");
      }
      const pgcr = await deps.destinyService.getPgcr(activity.activityId);
      return deps.cardService.renderActivityCard(pgcr);
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

async function resolveCardTarget(query: Query, deps: D2RouteDeps): Promise<CardTarget> {
  if (query.qq !== undefined) {
    const qq = parseQq(query.qq);
    const binding = await deps.store.getQqBinding(qq);
    if (!binding) {
      throw new NotFoundError("qq binding was not found");
    }
    await deps.store.touchQqBinding(qq);
    return {
      membershipType: binding.membershipType,
      membershipId: binding.membershipId,
      player: playerFromBinding(binding),
      cacheKey: `qq:${qq}:${binding.membershipType}:${binding.membershipId}`
    };
  }

  if (query.bungieName !== undefined) {
    const bungieName = getRequiredQueryString(query, "bungieName");
    const player = await deps.destinyService.searchPlayer(bungieName);
    return {
      membershipType: player.membershipType,
      membershipId: player.membershipId,
      player,
      cacheKey: `bungie:${player.bungieName.toLowerCase()}`
    };
  }

  if (query.membershipType !== undefined || query.membershipId !== undefined) {
    const membershipType = parseMembershipType(query.membershipType);
    const membershipId = parseId(query.membershipId, "membershipId");
    return {
      membershipType,
      membershipId,
      player: fallbackPlayer(membershipType, membershipId),
      cacheKey: `membership:${membershipType}:${membershipId}`
    };
  }

  throw new BadRequestError("Provide qq, bungieName, or membershipType and membershipId");
}

function playerFromBinding(binding: {
  membershipType: number;
  membershipId: string;
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
}): PlayerSearchResult {
  const parsed = parseBoundBungieName(binding.bungieName);
  const displayName = binding.displayName ?? parsed.displayName ?? `ID ${binding.membershipId.slice(-8)}`;
  const displayNameCode = binding.displayNameCode ?? parsed.displayNameCode ?? 0;
  return {
    bungieName: binding.bungieName ?? displayName,
    displayName,
    displayNameCode,
    membershipType: binding.membershipType,
    membershipId: binding.membershipId
  };
}

function fallbackPlayer(membershipType: number, membershipId: string): PlayerSearchResult {
  const displayName = `ID ${membershipId.slice(-8)}`;
  return {
    bungieName: displayName,
    displayName,
    displayNameCode: 0,
    membershipType,
    membershipId
  };
}

function parseBoundBungieName(value: string | undefined): { displayName?: string; displayNameCode?: number } {
  if (!value) {
    return {};
  }
  const match = /^(.+)#([0-9]{1,4})$/u.exec(value.trim());
  if (!match) {
    return { displayName: value.trim() };
  }
  return {
    displayName: match[1],
    displayNameCode: Number(match[2])
  };
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

function parseBoundedInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
  defaultValue: number
): number {
  if (value === undefined) {
    return defaultValue;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new BadRequestError(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function parseTimezone(value: unknown): string {
  const timezone = typeof value === "string" && value.trim().length > 0 ? value.trim() : "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new BadRequestError("Invalid timezone");
  }
}

function oauthRequired(feature: string): (request: FastifyRequest) => Promise<never> {
  return async (request) => {
    parseMembershipParams(request.params as Params);
    throw new OAuthRequiredError(`${feature} requires Bungie OAuth authorization`, {
      feature,
      reason: "Bungie does not expose this account-private data through API-key-only public requests.",
      nextStep: "Add OAuth login and request the required Destiny components before enabling this route."
    });
  };
}

async function resolveBindingInput(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
