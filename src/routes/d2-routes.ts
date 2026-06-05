import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CacheStore } from "../cache/cache.js";
import type { CardService } from "../cards/card-service.js";
import type { Store } from "../db/store.js";
import type { DestinyService } from "../destiny/destiny-service.js";
import type {
  InventoryBucketFilter,
  InventoryActionResult,
  LoadoutOptimizerApplyResult,
  PlayerSearchResult
} from "../destiny/destiny-types.js";
import type { QqOAuthService } from "../oauth/qq-oauth-service.js";
import { parseQq } from "../bindings/qq.js";
import { parseCount, parseId, parseMembershipType, parsePage } from "../destiny/validators.js";
import { BadRequestError, NotFoundError, OAuthRequiredError, toAppError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { ok } from "../lib/response.js";
import { renderOAuthResultHtml, renderOAuthSelectionHtml } from "../oauth/qq-oauth-service.js";

export interface D2RouteDeps {
  destinyService: DestinyService;
  cardService: CardService;
  cache: CacheStore;
  store: Store;
  qqOAuthService: QqOAuthService;
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

  app.post("/api/d2/bindings/qq/oauth/start", async (request) => {
    const started = Date.now();
    const body = request.body as Record<string, unknown>;
    const data = await deps.qqOAuthService.startQqBinding(body?.qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/bindings/qq/oauth/authorize", async (request, reply) => {
    try {
      const query = request.query as Query;
      const state = await deps.qqOAuthService.assertStartState(query.state);
      return reply.redirect(deps.qqOAuthService.buildAuthorizeUrl(state));
    } catch (error) {
      const appError = toAppError(error);
      return reply
        .status(appError.statusCode)
        .type("text/html; charset=utf-8")
        .send(renderOAuthResultHtml("绑定链接不可用", appError.message));
    }
  });

  app.get("/api/d2/bindings/qq/oauth/callback", async (request, reply) => {
    try {
      const query = request.query as Query;
      if (typeof query.error === "string" && query.error.length > 0) {
        throw new BadRequestError(`Bungie authorization failed: ${query.error}`);
      }
      const result = await deps.qqOAuthService.completeCallback(query.code, query.state);
      await recordQuery(deps.store, request, false);
      return reply.type("text/html; charset=utf-8").send(renderOAuthSelectionHtml(result));
    } catch (error) {
      const appError = toAppError(error);
      return reply
        .status(appError.statusCode)
        .type("text/html; charset=utf-8")
        .send(renderOAuthResultHtml("绑定失败", appError.message));
    }
  });

  app.post("/api/d2/bindings/qq/oauth/confirm", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const saved = await deps.qqOAuthService.confirmSelection(body.confirmToken, body.membershipType, body.membershipId);
      await recordQuery(deps.store, request, false);
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderOAuthResultHtml(
            "绑定成功",
            `QQ ${saved.qq} 已绑定到 ${saved.bungieName ?? `${saved.membershipType}:${saved.membershipId}`}，可以回 QQ 查询命运2战绩了。`
          )
        );
    } catch (error) {
      const appError = toAppError(error);
      return reply
        .status(appError.statusCode)
        .type("text/html; charset=utf-8")
        .send(renderOAuthResultHtml("绑定失败", appError.message));
    }
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
    return ok(publicQqBinding({ ...binding, lastResolvedAt: new Date().toISOString() }), {
      tookMs: Date.now() - started
    });
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
    const count = parseBoundedInteger(query.count, "count", 1, 50, 50);
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
      historyPages: parseBoundedInteger(query.historyPages, "historyPages", 1, 10, 10),
      pgcrLimit: parseBoundedInteger(query.pgcrLimit, "pgcrLimit", 0, 200, 100)
    });
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/grandmasters/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const query = request.query as Query;
    const data = await deps.destinyService.getGrandmasterOverview(membershipType, membershipId, {
      historyPages: parseBoundedInteger(query.historyPages, "historyPages", 1, 10, 10),
      pgcrLimit: parseBoundedInteger(query.pgcrLimit, "pgcrLimit", 0, 200, 50),
      season: parseGrandmasterSeason(query.season)
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
    const timezone = parseTimezone(query.timezone);
    const range = parseHeatmapRange(query.range);
    const data = await deps.destinyService.getHeatmap(membershipType, membershipId, query.mode, {
      pages: parseBoundedInteger(query.pages, "pages", 1, 10, 2),
      timezone,
      range,
      year: range === "year" ? parseHeatmapYear(query.year, timezone) : undefined
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

  app.get("/api/d2/inventory/qq/:qq", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory management");
    const data = await deps.destinyService.getPrivateInventory(
      binding.membershipType,
      binding.membershipId,
      accessToken,
      qq
    );
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.get("/api/d2/inventory/qq/:qq/search", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const query = request.query as Query;
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory search");
    const data = await deps.destinyService.searchPrivateInventory(
      binding.membershipType,
      binding.membershipId,
      accessToken,
      {
        qq,
        query: typeof query.q === "string" ? query.q : "",
        bucket: parseInventoryBucket(query.bucket),
        weaponType: parseOptionalQueryString(query.weaponType),
        rpm: parseOptionalBoundedInteger(query.rpm, "rpm", 1, 2000),
        slot: parseOptionalQueryString(query.slot),
        damageType: parseOptionalQueryString(query.damageType),
        perk: parseOptionalQueryString(query.perk),
        characterId:
          query.characterId === undefined || query.characterId === ""
            ? undefined
            : parseId(query.characterId, "characterId")
      }
    );
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.post("/api/d2/inventory/qq/:qq/transfer", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory transfer");
    const body = requireRecordBody(request.body);
    return runInventoryAction(deps, request, qq, "inventory.transfer", body.itemId, async () =>
      deps.destinyService.transferInventoryItem(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        itemReferenceHash: parseHash(body.itemReferenceHash, "itemReferenceHash"),
        stackSize: parseBoundedInteger(body.stackSize, "stackSize", 1, 9999, 1),
        transferToVault: parseBoolean(body.transferToVault, "transferToVault"),
        itemId: parseNumericId(body.itemId, "itemId"),
        characterId: parseNumericId(body.characterId, "characterId")
      })
    );
  });

  app.post("/api/d2/inventory/qq/:qq/equip", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory equip");
    const body = requireRecordBody(request.body);
    return runInventoryAction(deps, request, qq, "inventory.equip", body.itemId, async () =>
      deps.destinyService.equipInventoryItem(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        itemId: parseNumericId(body.itemId, "itemId"),
        characterId: parseNumericId(body.characterId, "characterId")
      })
    );
  });

  app.post("/api/d2/inventory/qq/:qq/equip-items", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory equip items");
    const body = requireRecordBody(request.body);
    const itemIds = parseIdArray(body.itemIds, "itemIds", 1, 10);
    return runInventoryAction(deps, request, qq, "inventory.equipItems", itemIds.join(","), async () =>
      deps.destinyService.equipInventoryItems(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        itemIds,
        characterId: parseNumericId(body.characterId, "characterId")
      })
    );
  });

  app.post("/api/d2/inventory/qq/:qq/lock", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Inventory lock");
    const body = requireRecordBody(request.body);
    return runInventoryAction(deps, request, qq, "inventory.lock", body.itemId, async () =>
      deps.destinyService.setInventoryItemLockState(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        itemId: parseNumericId(body.itemId, "itemId"),
        characterId: parseNumericId(body.characterId, "characterId"),
        state: parseBoolean(body.state, "state")
      })
    );
  });

  app.get("/api/d2/loadouts/qq/:qq", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Loadouts");
    const data = await deps.destinyService.getLoadouts(binding.membershipType, binding.membershipId, accessToken, qq);
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.post("/api/d2/loadouts/qq/:qq/equip", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Loadout equip");
    const body = requireRecordBody(request.body);
    return runInventoryAction(deps, request, qq, "loadout.equip", body.loadoutIndex, async () =>
      deps.destinyService.equipLoadout(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        characterId: parseNumericId(body.characterId, "characterId"),
        loadoutIndex: parseBoundedInteger(body.loadoutIndex, "loadoutIndex", 0, 9, 0)
      })
    );
  });

  app.post("/api/d2/loadout-optimizer/qq/:qq/search", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Loadout optimizer");
    const body = requireRecordBody(request.body);
    const data = await deps.destinyService.searchLoadoutOptimizer(
      binding.membershipType,
      binding.membershipId,
      accessToken,
      {
        qq,
        className: getRequiredBodyString(body, "className"),
        targetStats: isRecord(body.targetStats) ? body.targetStats : undefined,
        includeCurrentSubclassFragments: parseOptionalBoolean(body.includeCurrentSubclassFragments, true),
        simulateStatMods: parseOptionalBoolean(body.simulateStatMods, true),
        limit: parseBoundedInteger(body.limit, "limit", 1, 10, 3)
      }
    );
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  });

  app.post("/api/d2/loadout-optimizer/qq/:qq/apply", async (request) => {
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Loadout optimizer apply");
    const body = requireRecordBody(request.body);
    return runInventoryAction(deps, request, qq, "loadoutOptimizer.apply", body.buildId, async () =>
      deps.destinyService.applyLoadoutOptimizerBuild(binding.membershipType, binding.membershipId, accessToken, {
        qq,
        sessionId: getRequiredBodyString(body, "sessionId"),
        buildId: getRequiredBodyString(body, "buildId"),
        characterId:
          body.characterId === undefined || body.characterId === "" ? undefined : parseNumericId(body.characterId, "characterId"),
        confirm: parseBoolean(body.confirm, "confirm")
      })
    );
  });

  app.get("/api/d2/vault/:membershipType/:membershipId/search", oauthRequired("Vault search"));
  app.get("/api/d2/inventory/:membershipType/:membershipId/weapons", oauthRequired("Private inventory weapons"));
  app.get("/api/d2/catalysts/:membershipType/:membershipId", oauthRequired("Catalyst progress"));
  app.get("/api/d2/titles/:membershipType/:membershipId", oauthRequired("Triumph seal and title progress"));
  app.get("/api/d2/skins/:membershipType/:membershipId", oauthRequired("Collection and ornament ownership"));

  app.get("/api/d2/catalysts/qq/:qq", async (request) => {
    const started = Date.now();
    const qq = parseQq((request.params as Params).qq);
    const { binding, accessToken } = await resolveQqOAuthContext(deps, qq, "Catalyst progress");
    const data = await deps.destinyService.getCatalysts(binding.membershipType, binding.membershipId, accessToken);
    await deps.store.touchQqBinding(qq);
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

  app.get("/api/d2/craftables/:membershipType/:membershipId", async (request) => {
    const started = Date.now();
    const { membershipType, membershipId } = parseMembershipParams(request.params as Params);
    const data = await deps.destinyService.getCraftables(membershipType, membershipId);
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
      const activities = await deps.destinyService.getActivities(target.membershipType, target.membershipId, mode, 25, 0);
      const activity = activities.find(isCompletedActivity) ?? activities[0];
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

function isCompletedActivity(activity: { values: Record<string, unknown> }): boolean {
  const completed = activity.values.completed;
  if (typeof completed !== "object" || completed === null || Array.isArray(completed)) {
    return false;
  }
  const basic = (completed as Record<string, unknown>).basic;
  if (typeof basic !== "object" || basic === null || Array.isArray(basic)) {
    return false;
  }
  return Number((basic as Record<string, unknown>).value ?? 0) > 0;
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
    const profile = await deps.destinyService.getProfile(membershipType, membershipId);
    return {
      membershipType,
      membershipId,
      player: playerFromProfile(profile) ?? fallbackPlayer(membershipType, membershipId),
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

function playerFromProfile(profile: {
  membershipType: number;
  membershipId: string;
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
  iconPath?: string;
}): PlayerSearchResult | null {
  const parsed = parseBoundBungieName(profile.bungieName);
  const displayName = profile.displayName ?? parsed.displayName;
  if (!displayName) {
    return null;
  }
  const displayNameCode = profile.displayNameCode ?? parsed.displayNameCode ?? 0;
  return {
    bungieName: profile.bungieName ?? (displayNameCode > 0 ? `${displayName}#${displayNameCode}` : displayName),
    displayName,
    displayNameCode,
    membershipType: profile.membershipType,
    membershipId: profile.membershipId,
    iconPath: profile.iconPath
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

function publicQqBinding<T extends { oauth?: unknown }>(binding: T): Omit<T, "oauth"> {
  const { oauth: _oauth, ...publicBinding } = binding;
  return publicBinding;
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

function parseOptionalQueryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getRequiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
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

function parseOptionalBoundedInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseBoundedInteger(value, name, min, max, min);
}

function parseInventoryBucket(value: unknown): InventoryBucketFilter {
  const bucket = typeof value === "string" && value.trim().length > 0 ? value.trim() : "all";
  if (bucket === "all" || bucket === "vault" || bucket === "inventory" || bucket === "equipped") {
    return bucket;
  }
  throw new BadRequestError("bucket must be one of all, vault, inventory, equipped");
}

function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  throw new BadRequestError(`${name} must be a boolean`);
}

function parseOptionalBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return parseBoolean(value, "boolean option");
}

function parseHash(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 4_294_967_295) {
    throw new BadRequestError(`${name} must be an unsigned 32-bit integer`);
  }
  return number;
}

function parseNumericId(value: unknown, name: string): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return parseId(String(value), name);
  }
  return parseId(value, name);
}

function parseIdArray(value: unknown, name: string, min: number, max: number): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestError(`${name} must be an array`);
  }
  if (value.length < min || value.length > max) {
    throw new BadRequestError(`${name} must contain between ${min} and ${max} ids`);
  }
  return value.map((entry, index) => parseNumericId(entry, `${name}[${index}]`));
}

function requireRecordBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new BadRequestError("Request body must be an object");
  }
  return body;
}

function friendlyInventoryErrorMessage(error: ReturnType<typeof toAppError>): string {
  const details = isRecord(error.details) ? error.details : {};
  const status = String(
    (error as unknown as { bungieErrorStatus?: unknown }).bungieErrorStatus ?? details.ErrorStatus ?? details.errorStatus ?? ""
  );
  if (/DestinyAccountNotFound|OAuth/i.test(status) || error.code === "OAUTH_REQUIRED") {
    return "需要重新进行 Bungie OAuth 授权。";
  }
  if (/ItemNotFound|ItemUniqueIdentity/i.test(status)) {
    return "没有找到这个物品实例，请刷新库存后重试。";
  }
  if (/CannotPerformAction|NotInOrbit|Character/i.test(status)) {
    return "Bungie 拒绝了装备操作；通常需要角色在轨道、社交空间或离线。";
  }
  if (/Transfer|Bucket|Full|Item/i.test(status)) {
    return "物品当前不可转移或目标背包已满。";
  }
  return error.message;
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

function parseHeatmapRange(value: unknown): "all" | "year" | "recent" {
  const range = typeof value === "string" && value.trim().length > 0 ? value.trim() : "all";
  if (range === "all" || range === "year" || range === "recent") {
    return range;
  }
  throw new BadRequestError("range must be one of all, year, recent");
}

function parseGrandmasterSeason(value: unknown): "current" | "all" {
  const season = typeof value === "string" && value.trim().length > 0 ? value.trim() : "current";
  if (season === "current" || season === "all") {
    return season;
  }
  throw new BadRequestError("season must be one of current or all");
}

function parseHeatmapYear(value: unknown, timezone: string): number {
  if (value === undefined || value === null || value === "") {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric"
      }).format(new Date())
    );
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2017 || year > 2100) {
    throw new BadRequestError("year must be an integer between 2017 and 2100");
  }
  return year;
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

async function assertQqOAuthMatchesBinding(
  store: Store,
  qq: string,
  membershipType: number,
  membershipId: string,
  feature = "Private Destiny data"
): Promise<void> {
  const token = await store.getQqOAuthToken(qq);
  if (!token || token.revokedAt) {
    throw new OAuthRequiredError("QQ binding does not have active Bungie OAuth authorization", {
      feature,
      reason: `${feature} is account-private and requires the bound QQ owner to authorize Bungie OAuth.`
    });
  }
  if (token.membershipType !== membershipType || token.membershipId !== membershipId) {
    throw new OAuthRequiredError("QQ OAuth authorization does not match the bound Destiny membership", {
      feature,
      reason: "The saved OAuth token belongs to a different Destiny membership; bind again before using this private feature."
    });
  }
}

async function resolveQqOAuthContext(deps: D2RouteDeps, qq: string, feature: string) {
  const binding = await deps.store.getQqBinding(qq);
  if (!binding) {
    throw new NotFoundError("qq binding was not found");
  }
  await assertQqOAuthMatchesBinding(deps.store, qq, binding.membershipType, binding.membershipId, feature);
  const accessToken = await deps.qqOAuthService.getValidAccessTokenForQq(qq);
  await assertQqOAuthMatchesBinding(deps.store, qq, binding.membershipType, binding.membershipId, feature);
  return { binding, accessToken };
}

async function runInventoryAction(
  deps: D2RouteDeps,
  request: FastifyRequest,
  qq: string,
  action: string,
  target: unknown,
  execute: () => Promise<InventoryActionResult | LoadoutOptimizerApplyResult>
) {
  const started = Date.now();
  try {
    const data = await execute();
    await auditInventoryAction(deps.store, request, qq, action, target, {
      ok: true,
      resultAction: "action" in data ? data.action : "loadoutOptimizerApply",
      itemId: "itemId" in data ? data.itemId : undefined,
      itemIds: "equippedItemIds" in data ? data.equippedItemIds : data.itemIds,
      itemHash: "itemHash" in data ? data.itemHash : undefined,
      characterId: data.characterId,
      loadoutIndex: "loadoutIndex" in data ? data.loadoutIndex : undefined,
      sessionId: "sessionId" in data ? data.sessionId : undefined,
      buildId: "buildId" in data ? data.buildId : undefined
    });
    await deps.store.touchQqBinding(qq);
    await recordQuery(deps.store, request, false);
    return ok(data, { tookMs: Date.now() - started });
  } catch (error) {
    const appError = toAppError(error);
    await auditInventoryAction(deps.store, request, qq, action, target, {
      ok: false,
      code: appError.code,
      statusCode: appError.statusCode,
      message: friendlyInventoryErrorMessage(appError),
      bungieErrorCode: (error as { bungieErrorCode?: unknown }).bungieErrorCode,
      bungieErrorStatus: (error as { bungieErrorStatus?: unknown }).bungieErrorStatus
    });
    throw error;
  }
}

async function auditInventoryAction(
  store: Store,
  request: FastifyRequest,
  qq: string,
  action: string,
  target: unknown,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await store.logAdminAudit({
      actor: `qq:${qq}`,
      action,
      target: target === undefined || target === null ? undefined : String(target),
      ipHash: sha256Hex(request.ip),
      details
    });
  } catch {
    return;
  }
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
