import type { CacheStore } from "../cache/cache.js";
import type { SavedLoadoutRow, Store } from "../db/store.js";
import { randomBytes } from "node:crypto";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { asArray, asBoolean, asNumber, asRecord, asString, numberFrom, optionalNumber, optionalString } from "../lib/json.js";
import {
  CACHE_TTL,
  CATALYST_COMPONENTS,
  CRAFTABLES_COMPONENTS,
  PRIVATE_INVENTORY_COMPONENTS,
  PROFILE_COMPONENTS
} from "./constants.js";
import { parseBungieName } from "./bungie-name.js";
import type { BungieClient } from "./bungie-client.js";
import type {
  AccountSummary,
  ActivityModeOverview,
  ActivityModeOverviewActivity,
  ActivitySummary,
  CareerModeSummary,
  CareerSummary,
  CatalystObjectiveSummary,
  CatalystInfoMatch,
  CatalystInfoSummary,
  CatalystSlot,
  CatalystStatusMatch,
  CatalystStatusSummary,
  CatalystWeaponGroup,
  CatalystWeaponSummary,
  CatalystsSummary,
  CharacterSummary,
  CraftableWeaponGroup,
  CraftableWeaponSummary,
  CraftablesSummary,
  DungeonOverview,
  DungeonOverviewActivity,
  GrandmasterOverview,
  GrandmasterRecentActivity,
  GrandmasterRecentPlayer,
  GrandmasterSeasonScope,
  GrandmasterStrikeSummary,
  HeatmapBucket,
  HeatmapCalendarYear,
  HeatmapRange,
  HeatmapSummary,
  InventoryArmorStatSummary,
  InventoryArmorStatsSummary,
  InventoryActionResult,
  InventoryBucketFilter,
  InventoryTransferItemsRequest,
  InventoryTransferItemsSummary,
  InventoryTransferItemResult,
  InventoryItemSummary,
  InventoryOwner,
  InventoryPlugSummary,
  InventorySearchSummary,
  InventorySocketSummary,
  InventorySummary,
  InventoryWeaponStatSummary,
  ItemInfoMatch,
  ItemInfoSummary,
  LoadoutOptimizerApplyResult,
  LoadoutOptimizerArmorItem,
  LoadoutOptimizerBuild,
  LoadoutOptimizerFragmentSuggestion,
  LoadoutOptimizerSearchSummary,
  LoadoutOptimizerStatModSuggestion,
  LoadoutOptimizerTargetStat,
  LoadoutOptimizerStatValue,
  LoadoutsSummary,
  NamecardSummary,
  PerkWeaponMatch,
  PerkWeaponPerkSummary,
  PerkWeaponsSummary,
  PgcrPlayerSummary,
  PgcrSummary,
  PlayerSearchResult,
  ProfileSummary,
  PvpAggregateStats,
  PvpMatchSummary,
  PvpMatchWeaponSummary,
  PvpModeBreakdown,
  PvpOverview,
  PvpRecentWeaponSummary,
  RaidOverview,
  RaidOverviewActivity,
  SavedLoadoutApplyResult,
  SavedLoadoutSummary,
  WeaponUsageSummary,
  WeaponsSummary
} from "./destiny-types.js";
import type { ManifestService } from "./manifest-service.js";
import { parsePublicMode, type ModeInfo, type PublicMode } from "./modes.js";
import { findRaidReleaseWindow } from "./raid-release-windows.js";
import {
  EMPTY_HISTORICAL_SUMMARY,
  aggregatePgcrPlayerValues,
  round,
  statBasicValue,
  summarizeHistoricalStats
} from "./stat-utils.js";

const RAID_MODE_TYPE = 4;
const DUNGEON_MODE_TYPE = 82;
const GRANDMASTER_NIGHTFALL_MODE_TYPE = 46;
const RAID_HISTORY_PAGE_SIZE = 250;
const HEATMAP_FULL_HISTORY_MAX_PAGES = 100;
const KINETIC_BUCKET_HASHES = new Set([1498876634]);
const ENERGY_BUCKET_HASHES = new Set([2465295065]);
const POWER_BUCKET_HASHES = new Set([953998645]);
const WEAPON_RPM_STAT_HASH = 4284893193;
const ARMOR_BUCKETS: Record<number, { slot: string; label: string; order: number }> = {
  3448274439: { slot: "helmet", label: "头盔", order: 10 },
  3551918588: { slot: "gauntlets", label: "臂铠", order: 20 },
  14239492: { slot: "chest", label: "胸甲", order: 30 },
  20886954: { slot: "legs", label: "腿甲", order: 40 },
  1585787867: { slot: "class_item", label: "职业物品", order: 50 }
};
const ARMOR_SLOT_ORDER = ["helmet", "gauntlets", "chest", "legs", "class_item"] as const;
const LOADOUT_OPTIMIZER_SESSION_TTL_SECONDS = 10 * 60;
const LOADOUT_OPTIMIZER_MAX_PARTIALS = 3000;
const LOADOUT_OPTIMIZER_MAX_FRAGMENT_COMBOS = 2000;
const LOADOUT_OPTIMIZER_STAT_HASHES = {
  mobility: 2996146975,
  resilience: 392767087,
  recovery: 1943323491,
  discipline: 1735777505,
  intellect: 144602215,
  strength: 4244567218
} as const;
const LOADOUT_OPTIMIZER_STAT_LABELS: Record<string, string> = {
  mobility: "武器",
  resilience: "生命值",
  recovery: "职业",
  discipline: "手雷",
  intellect: "超能",
  strength: "近战"
};
const CATALYST_SLOT_ORDER: CatalystSlot[] = ["kinetic", "energy", "power", "unknown"];
const CATALYST_SLOT_LABELS: Record<CatalystSlot, string> = {
  kinetic: "动能武器",
  energy: "能量武器",
  power: "威能武器",
  unknown: "未知武器"
};
const ARMOR_STAT_HASHES = [
  2996146975, // Mobility
  392767087, // Resilience
  1943323491, // Recovery
  1735777505, // Discipline
  144602215, // Intellect
  4244567218 // Strength
] as const;
const ARMOR_STAT_FALLBACK_NAMES: Record<number, string> = {
  2996146975: "武器",
  392767087: "生命值",
  1943323491: "职业",
  1735777505: "手雷",
  144602215: "超能",
  4244567218: "近战"
};
const ARMOR_3_STAT_NAMES = new Set(Object.values(ARMOR_STAT_FALLBACK_NAMES));

export class DestinyService {
  constructor(
    private readonly client: BungieClient,
    private readonly cache: CacheStore,
    private readonly store: Store,
    private readonly manifest: ManifestService
  ) {}

  async searchPlayer(bungieName: string): Promise<PlayerSearchResult> {
    const parsed = parseBungieName(bungieName);
    const cacheKey = `d2:search:${parsed.normalized}`;
    const cached = await this.cache.getJson<PlayerSearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.post<unknown[]>("/Destiny2/SearchDestinyPlayerByBungieName/-1/", {
      body: {
        displayName: parsed.displayName,
        displayNameCode: parsed.displayNameCode
      }
    });

    const first = asArray(response)[0];
    if (!first) {
      throw new NotFoundError("Player not found");
    }

    const playerRecord = asRecord(first);
    const result: PlayerSearchResult = {
      bungieName: parsed.raw,
      displayName: asString(playerRecord.displayName, parsed.displayName),
      displayNameCode: asNumber(playerRecord.bungieGlobalDisplayNameCode, parsed.displayNameCode),
      membershipType: asNumber(playerRecord.membershipType),
      membershipId: asString(playerRecord.membershipId),
      iconPath: optionalString(playerRecord.iconPath)
    };

    if (!result.membershipId || !result.membershipType) {
      throw new BadRequestError("Bungie returned an invalid membership result", first);
    }

    await this.cache.setJson(cacheKey, result, CACHE_TTL.playerSearch);
    await this.store.upsertPlayer(result);
    return result;
  }

  async getProfile(membershipType: number, membershipId: string): Promise<ProfileSummary> {
    const cacheKey = `d2:profile:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<ProfileSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.get<unknown>(`/Destiny2/${membershipType}/Profile/${membershipId}/`, {
      query: {
        components: [...PROFILE_COMPONENTS]
      }
    });

    const profileResponse = asRecord(response);
    const profileData = asRecord(asRecord(profileResponse.profile).data);
    const userInfo = asRecord(profileData.userInfo);
    const charactersData = asRecord(asRecord(profileResponse.characters).data);
    const characterIds = asArray(profileData.characterIds).map(String);
    const displayName = optionalString(userInfo.bungieGlobalDisplayName) || optionalString(userInfo.displayName);
    const displayNameCode = optionalNumber(userInfo.bungieGlobalDisplayNameCode);

    const characters = await Promise.all(
      Object.entries(charactersData).map(([characterId, value]) =>
        this.toCharacterSummary(characterId, asRecord(value))
      )
    );

    const result: ProfileSummary = {
      membershipType,
      membershipId,
      ...(displayName
        ? {
            bungieName: displayNameCode !== undefined && displayNameCode > 0 ? `${displayName}#${displayNameCode}` : displayName,
            displayName,
            displayNameCode: displayNameCode ?? 0
          }
        : {}),
      iconPath: optionalString(userInfo.iconPath),
      profile: {
        dateLastPlayed: optionalString(profileData.dateLastPlayed),
        minutesPlayedTotal: numberFrom(profileData.minutesPlayedTotal),
        characterIds
      },
      characters
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.profile);
    return result;
  }

  async getSummary(membershipType: number, membershipId: string, modeValue: unknown): Promise<AccountSummary> {
    const mode = parsePublicMode(modeValue);
    const cacheKey = `d2:summary:${membershipType}:${membershipId}:${mode.publicMode}`;
    const cached = await this.cache.getJson<AccountSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.getHistoricalStatsSummary(membershipType, membershipId, "0", mode);

    await this.cache.setJson(cacheKey, result, CACHE_TTL.summary);
    return result;
  }

  async getCareerSummary(membershipType: number, membershipId: string): Promise<CareerSummary> {
    const cacheKey = `d2:career:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<CareerSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const [profile, modes, seasons] = await Promise.all([
      this.getProfile(membershipType, membershipId),
      mapLimit(CAREER_MODES, 4, (mode) => this.getSafeHistoricalStatsSummary(membershipType, membershipId, "0", mode)),
      this.getCareerSeasons()
    ]);
    const characters = await mapLimit(profile.characters, 2, async (character) => ({
      ...character,
      totalSecondsPlayed: character.minutesPlayedTotal * 60,
      modeSummaries: await mapLimit(CHARACTER_CAREER_MODES, 4, (mode) =>
        this.getSafeHistoricalStatsSummary(membershipType, membershipId, character.characterId, mode)
      )
    }));

    const result: CareerSummary = {
      membershipType,
      membershipId,
      modes,
      profile: {
        ...profile,
        characters
      },
      seasons,
      characters,
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.career);
    return result;
  }

  async getPvpOverview(membershipType: number, membershipId: string, count: number): Promise<PvpOverview> {
    const cacheKey = `d2:pvp-overview:${membershipType}:${membershipId}:${count}`;
    const cached = await this.cache.getJson<PvpOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const [summary, trials, recent, weapons] = await Promise.all([
      this.getSummary(membershipType, membershipId, "pvp"),
      this.getSummary(membershipType, membershipId, "trials"),
      this.getActivities(membershipType, membershipId, "pvp", count, 0),
      this.getWeapons(membershipType, membershipId)
    ]);
    const pgcrs = await mapLimit(recent.slice(0, count), 5, async (activity) => {
      try {
        return await this.getPgcr(activity.activityId);
      } catch {
        return null;
      }
    });
    const matches = pgcrs
      .filter((pgcr): pgcr is PgcrSummary => pgcr !== null)
      .map((pgcr) => this.toPvpMatchSummary(pgcr, membershipId))
      .filter((match): match is PvpMatchSummary => match !== null);

    const result: PvpOverview = {
      membershipType,
      membershipId,
      summary,
      trials,
      recent,
      aggregates: aggregatePvpMatches(matches),
      kdComparison: matches.slice(0, 20).map((match) => ({
        activityId: match.activityId,
        activityName: match.activityName,
        period: match.period,
        result: match.result,
        playerKd: match.kd,
        teamKd: match.teamKd,
        opponentKd: match.opponentKd
      })),
      recentWeapons: aggregatePvpWeapons(matches).slice(0, 12),
      modeBreakdown: aggregatePvpModes(matches).slice(0, 4),
      matches,
      weapons: weapons.weapons.slice(0, 25),
      weaponScope: `recent ${matches.length} public PvP PGCRs plus all-time unique weapon fallback`,
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.summary);
    return result;
  }

  async getNamecard(membershipType: number, membershipId: string): Promise<NamecardSummary> {
    const cacheKey = `d2:namecard:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<NamecardSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const [profile, summary] = await Promise.all([
      this.getProfile(membershipType, membershipId),
      this.getSummary(membershipType, membershipId, "all")
    ]);
    const result: NamecardSummary = {
      membershipType,
      membershipId,
      profile,
      summary,
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.profile);
    return result;
  }

  async getDungeonOverview(
    membershipType: number,
    membershipId: string,
    options: { historyPages: number; pgcrLimit: number }
  ): Promise<DungeonOverview> {
    const cacheKey = `d2:dungeon-overview:${membershipType}:${membershipId}:${options.historyPages}:${options.pgcrLimit}`;
    const cached = await this.cache.getJson<DungeonOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const activityDefinitions = await this.manifest.getDefinitionMap<RaidActivityDefinition>(
      "DestinyActivityDefinition"
    );
    const aggregateResults = await Promise.allSettled(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );
    const aggregateResponses = aggregateResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const aggregateErrors = aggregateResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${profile.characters[index]?.characterId ?? "unknown"}: ${scanErrorMessage(result.reason)}`]
        : []
    );
    const aggregateStatsAvailable = aggregateResponses.length > 0;

    const groups = new Map<string, DungeonOverviewGroup>();
    for (const response of aggregateResponses) {
      for (const activity of asArray(asRecord(response).activities)) {
        this.addAggregateDungeonActivity(groups, asRecord(activity), activityDefinitions);
      }
    }

    const dungeonMode = parsePublicMode("dungeon");
    const recentActivities = await this.getRecentModeActivitiesForScan(
      membershipType,
      membershipId,
      profile.characters.map((character) => character.characterId),
      dungeonMode,
      options.historyPages,
      activityDefinitions
    );

    for (const activity of recentActivities) {
      const group = this.groupForDungeonActivity(groups, activity.referenceId, activity.activityName, activityDefinitions);
      if (!group) {
        continue;
      }
      const completed = statBasicValue(activity.values, "completed") > 0;
      if (completed && (!group.lastClearedAt || activity.period > group.lastClearedAt)) {
        group.lastClearedAt = activity.period;
        group.lastActivityId = activity.activityId;
      }
      if (!aggregateStatsAvailable && completed) {
        group.completions += 1;
        group.fullClears += 1;
        group.wins = group.fullClears;
        group.kills += statBasicValue(activity.values, "kills");
        group.deaths += statBasicValue(activity.values, "deaths");
        group.secondsPlayed +=
          statBasicValue(activity.values, "activityDurationSeconds") || statBasicValue(activity.values, "secondsPlayed");
      }
    }

    const completedActivities = options.pgcrLimit > 0
      ? recentActivities
        .filter((activity) => statBasicValue(activity.values, "completed") > 0)
        .filter(uniqueActivity())
        .slice(0, options.pgcrLimit)
      : [];

    const scannedGroupNames = new Set<string>();
    const pgcrResults = await mapLimit(completedActivities, 5, async (activity) => {
      try {
        const pgcr = await this.getPgcr(activity.activityId);
        return { activity, pgcr };
      } catch {
        return null;
      }
    });

    let pgcrScanned = 0;
    for (const result of pgcrResults) {
      if (!result) {
        continue;
      }
      pgcrScanned += 1;
      const group = this.groupForDungeonActivity(groups, result.activity.referenceId, result.pgcr.activityName, activityDefinitions);
      if (!group) {
        continue;
      }
      scannedGroupNames.add(group.key);
      this.applyDungeonPgcrScan(group, result.pgcr, membershipId);
    }

    for (const group of groups.values()) {
      if (scannedGroupNames.has(group.key) && !group.flawless.personal && group.flawless.status === "unknown") {
        group.flawless.status = "not_found_in_scanned_pgcr";
      }
    }

    const dungeons = [...groups.values()]
      .map(finalizeDungeonGroup)
      .filter((dungeon) => dungeon.fullClears > 0 || dungeon.completions > 0)
      .sort((a, b) =>
        b.fullClears - a.fullClears ||
        b.completions - a.completions ||
        difficultySort(a.difficulty) - difficultySort(b.difficulty) ||
        a.name.localeCompare(b.name)
      );
    const fastestDungeon = dungeons
      .filter((dungeon) => dungeon.fastestCompletionMs !== undefined)
      .sort((a, b) => Number(a.fastestCompletionMs) - Number(b.fastestCompletionMs))[0];

    const result: DungeonOverview = {
      membershipType,
      membershipId,
      mode: "dungeon",
      modeLabel: "地牢",
      totals: {
        activities: dungeons.length,
        dungeons: dungeons.length,
        clears: dungeons.reduce((sum, dungeon) => sum + dungeon.fullClears, 0),
        fullClears: dungeons.reduce((sum, dungeon) => sum + dungeon.fullClears, 0),
        completions: dungeons.reduce((sum, dungeon) => sum + dungeon.completions, 0),
        sherpaCompletions: dungeons.reduce((sum, dungeon) => sum + dungeon.sherpaCompletions, 0),
        kills: dungeons.reduce((sum, dungeon) => sum + dungeon.kills, 0),
        deaths: dungeons.reduce((sum, dungeon) => sum + dungeon.deaths, 0),
        secondsPlayed: dungeons.reduce((sum, dungeon) => sum + dungeon.secondsPlayed, 0),
        fastestCompletionMs: fastestDungeon?.fastestCompletionMs,
        fastestCompletionDisplay: fastestDungeon?.fastestCompletionDisplay
      },
      activities: dungeons,
      dungeons,
      scan: {
        historyPages: options.historyPages,
        pgcrLimit: options.pgcrLimit,
        recentActivitiesScanned: recentActivities.length,
        pgcrScanned,
        note: "fullClears/completions/fastest are all-time aggregate stats; solo/duo/trio and flawless are only confirmed from scanned recent PGCRs; Bungie public APIs do not expose complete lifetime sherpa counts"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.dungeonOverview);
    return result;
  }

  async getGrandmasterOverview(
    membershipType: number,
    membershipId: string,
    options: { historyPages: number; pgcrLimit: number; season: GrandmasterSeasonScope }
  ): Promise<GrandmasterOverview> {
    const cacheKey = `d2:grandmasters:v3:${membershipType}:${membershipId}:${options.historyPages}:${options.pgcrLimit}:${options.season}`;
    const cached = await this.cache.getJson<GrandmasterOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const activityDefinitions = await this.manifest.getDefinitionMap<RaidActivityDefinition>(
      "DestinyActivityDefinition"
    );
    const activeSeason = await this.getActiveSeasonWindow();
    const aggregateResults = await Promise.allSettled(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );
    const aggregateResponses = aggregateResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const aggregateErrors = aggregateResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${profile.characters[index]?.characterId ?? "unknown"}: ${scanErrorMessage(result.reason)}`]
        : []
    );
    const aggregateStatsAvailable = aggregateResponses.length > 0;

    const groups = new Map<string, GrandmasterOverviewGroup>();
    for (const response of aggregateResponses) {
      for (const activity of asArray(asRecord(response).activities)) {
        this.addAggregateGrandmasterActivity(groups, asRecord(activity), activityDefinitions);
      }
    }

    const recentActivities = await this.getRecentGrandmasterActivitiesForScan(
      membershipType,
      membershipId,
      profile.characters.map((character) => character.characterId),
      options.historyPages,
      activityDefinitions
    );
    const seasonActivities = recentActivities.filter((activity) =>
      grandmasterActivityInSeason(activity.period, options.season, activeSeason)
    );

    for (const activity of seasonActivities) {
      const group = this.groupForGrandmasterActivity(groups, activity.referenceId, activity.activityName, activityDefinitions);
      if (!group) {
        continue;
      }
      const completed = statBasicValue(activity.values, "completed") > 0;
      group.attempts += 1;
      if (completed) {
        group.currentSeasonClears += 1;
        if (!aggregateStatsAvailable) {
          group.lifetimeClears += 1;
          group.completions += 1;
        }
        if (!group.lastClearedAt || activity.period > group.lastClearedAt) {
          group.lastClearedAt = activity.period;
          group.lastActivityId = activity.activityId;
        }
      }
      if (!aggregateStatsAvailable) {
        group.kills += statBasicValue(activity.values, "kills");
        group.deaths += statBasicValue(activity.values, "deaths");
        group.secondsPlayed +=
          statBasicValue(activity.values, "activityDurationSeconds") || statBasicValue(activity.values, "secondsPlayed");
      }
    }

    const activitiesForPgcr = seasonActivities.length > 0 ? seasonActivities : recentActivities;
    const pgcrCandidates = activitiesForPgcr.filter(uniqueActivity()).slice(0, options.pgcrLimit);
    const pgcrResults = await mapLimit(pgcrCandidates, 5, async (activity) => {
      try {
        const pgcr = await this.getPgcr(activity.activityId);
        return { activity, pgcr };
      } catch {
        return null;
      }
    });

    const recent: GrandmasterRecentActivity[] = [];
    let pgcrScanned = 0;
    for (const result of pgcrResults) {
      if (!result) {
        continue;
      }
      pgcrScanned += 1;
      const group = this.groupForGrandmasterActivity(
        groups,
        result.activity.referenceId,
        result.pgcr.activityName,
        activityDefinitions
      );
      if (group) {
        this.applyGrandmasterPgcrScan(group, result.activity, result.pgcr, membershipId);
      }
      recent.push(this.toGrandmasterRecentActivity(result.activity, result.pgcr, activityDefinitions));
    }

    const strikes = [...groups.values()]
      .map(finalizeGrandmasterGroup)
      .filter((strike) => strike.lifetimeClears > 0 || strike.currentSeasonClears > 0 || strike.attempts > 0)
      .sort((a, b) => b.currentSeasonClears - a.currentSeasonClears || b.lifetimeClears - a.lifetimeClears || a.name.localeCompare(b.name));
    const fastest = strikes
      .filter((strike) => Number(strike.fastestCompletionMs || 0) > 0)
      .sort((a, b) => Number(a.fastestCompletionMs || Infinity) - Number(b.fastestCompletionMs || Infinity))[0];
    const totalCompletions = strikes.reduce((sum, strike) => sum + strike.completions, 0);
    const totalSeconds = strikes.reduce((sum, strike) => sum + strike.secondsPlayed, 0);
    const currentSeasonReliable = Boolean(activeSeason);
    const result: GrandmasterOverview = {
      membershipType,
      membershipId,
      season: {
        scope: options.season,
        currentSeasonName: activeSeason?.name,
        currentSeasonStart: activeSeason?.startDate,
        currentSeasonEnd: activeSeason?.endDate,
        currentSeasonReliable
      },
      totals: {
        strikes: strikes.length,
        currentSeasonClears: strikes.reduce((sum, strike) => sum + strike.currentSeasonClears, 0),
        lifetimeClears: strikes.reduce((sum, strike) => sum + strike.lifetimeClears, 0),
        attempts: strikes.reduce((sum, strike) => sum + strike.attempts, 0),
        completions: totalCompletions,
        kills: strikes.reduce((sum, strike) => sum + strike.kills, 0),
        deaths: strikes.reduce((sum, strike) => sum + strike.deaths, 0),
        secondsPlayed: totalSeconds,
        fastestCompletionMs: fastest?.fastestCompletionMs,
        fastestCompletionDisplay: fastest?.fastestCompletionDisplay,
        averageCompletionSeconds: totalCompletions > 0 ? Math.round(totalSeconds / totalCompletions) : undefined
      },
      strikes,
      recent: recent.slice(0, options.pgcrLimit),
      scan: {
        historyPages: options.historyPages,
        pgcrLimit: options.pgcrLimit,
        season: options.season,
        aggregateStatsAvailable,
        aggregateCharactersScanned: aggregateResponses.length,
        ...(aggregateErrors.length > 0 ? { aggregateErrors } : {}),
        recentActivitiesScanned: recentActivities.length,
        pgcrScanned,
        currentSeasonReliable,
        note: currentSeasonReliable
          ? "生涯通关/最快优先来自 Bungie 聚合统计；当前赛季与最近队伍来自公开 Nightfall 历史和 PGCR 扫描。"
          : "无法从 Manifest 判定当前赛季，当前赛季字段按近期扫描结果展示。"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.grandmasterOverview);
    return result;
  }

  async getHeatmap(
    membershipType: number,
    membershipId: string,
    modeValue: unknown,
    options: { pages: number; timezone: string; range: HeatmapRange; year?: number }
  ): Promise<HeatmapSummary> {
    const mode = parsePublicMode(modeValue);
    const maxPagesPerCharacter = options.range === "recent" ? options.pages : HEATMAP_FULL_HISTORY_MAX_PAGES;
    const yearKey = options.range === "year" ? options.year ?? "current" : "all";
    const cacheKey = `d2:heatmap:v2:${membershipType}:${membershipId}:${mode.publicMode}:${options.range}:${yearKey}:${options.timezone}:${maxPagesPerCharacter}`;
    const cached = await this.cache.getJson<HeatmapSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const perCharacter = await Promise.all(
      profile.characters.map((character) =>
        this.getCharacterHeatmapActivities(
          membershipType,
          membershipId,
          character.characterId,
          mode,
          maxPagesPerCharacter,
          options.range
        ).catch((error: unknown) => ({
          activities: [],
          pagesScanned: 0,
          truncated: false,
          partial: true,
          error: heatmapErrorMessage(error)
        }))
      )
    );
    const activities = perCharacter
      .flatMap((result) => result.activities)
      .filter(uniqueActivity())
      .filter((activity) => activityMatchesHeatmapRange(activity.period, options.timezone, options.range, options.year))
      .sort((a, b) => a.period.localeCompare(b.period));

    const dayBuckets = new Map<string, HeatmapBucket>();
    const hourBuckets = new Map<string, HeatmapBucket>();
    for (const activity of activities) {
      const keys = heatmapKeys(activity.period, options.timezone);
      const completed = statBasicValue(activity.values, "completed") > 0 ? 1 : 0;
      const kills = statBasicValue(activity.values, "kills");
      const deaths = statBasicValue(activity.values, "deaths");
      const secondsPlayed = statBasicValue(activity.values, "activityDurationSeconds");
      addHeatmapBucket(dayBuckets, keys.day, completed, kills, deaths, secondsPlayed);
      addHeatmapBucket(hourBuckets, keys.hour, completed, kills, deaths, secondsPlayed);
    }
    const days = [...dayBuckets.values()].sort((a, b) => a.key.localeCompare(b.key));
    const hours = [...hourBuckets.values()].sort((a, b) => Number(a.key) - Number(b.key));
    const pageCounts = perCharacter.map((result) => result.pagesScanned);
    const truncated = options.range !== "recent" && perCharacter.some((result) => result.truncated);
    const partialErrors = perCharacter
      .filter((result) => result.partial && result.error)
      .map((result) => result.error as string);

    const result: HeatmapSummary = {
      membershipType,
      membershipId,
      mode: mode.publicMode,
      modeLabel: mode.label,
      timezone: options.timezone,
      range: options.range,
      ...(options.range === "year" && options.year !== undefined ? { year: options.year } : {}),
      activitiesScanned: activities.length,
      days,
      hours,
      calendar: buildHeatmapCalendar(days, options.range, options.year),
      scan: {
        range: options.range,
        pagesPerCharacter: pageCounts.length > 0 ? Math.max(...pageCounts) : 0,
        maxPagesPerCharacter,
        truncated,
        partial: partialErrors.length > 0,
        ...(partialErrors.length > 0 ? { errors: [...new Set(partialErrors)].slice(0, 5) } : {}),
        note:
          options.range === "recent"
            ? `最近 ${options.pages} 页公开活动历史`
            : partialErrors.length > 0
              ? "Bungie 活动历史扫描部分失败，已返回成功扫描到的公开活动"
              : truncated
                ? `已达到每角色 ${HEATMAP_FULL_HISTORY_MAX_PAGES} 页扫描上限，结果可能不完整`
                : "已扫描到公开活动历史空页"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, options.range === "recent" ? CACHE_TTL.heatmap : CACHE_TTL.heatmapLong);
    return result;
  }

  async getActivities(
    membershipType: number,
    membershipId: string,
    modeValue: unknown,
    count: number,
    page: number
  ): Promise<ActivitySummary[]> {
    const mode = parsePublicMode(modeValue);
    const cacheKey = `d2:activities:${membershipType}:${membershipId}:${mode.publicMode}:${count}:${page}`;
    const cached = await this.cache.getJson<ActivitySummary[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const perCharacter = await Promise.all(
      profile.characters.map((character) =>
        this.getCharacterActivities(membershipType, membershipId, character.characterId, mode, count, page)
      )
    );

    const activities = perCharacter
      .flat()
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, count);

    await this.cache.setJson(cacheKey, activities, CACHE_TTL.activities);
    return activities;
  }

  async getPgcr(activityId: string): Promise<PgcrSummary> {
    const cacheKey = `d2:pgcr:v2:${activityId}`;
    const cached = await this.cache.getJson<PgcrSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.get<unknown>(`/Destiny2/Stats/PostGameCarnageReport/${activityId}/`);
    const report = asRecord(response);
    const activityDetails = asRecord(report.activityDetails);
    const referenceId = optionalNumber(activityDetails.referenceId) ?? optionalString(activityDetails.referenceId);
    const activityName = await this.manifest.getDisplayName(
      "DestinyActivityDefinition",
      referenceId,
      `Activity ${asString(referenceId)}`
    );

    const players = await Promise.all(asArray(report.entries).map((entry) => this.toPgcrPlayer(asRecord(entry))));

    const result: PgcrSummary = {
      activityId,
      period: optionalString(report.period),
      activityName,
      mode: optionalNumber(activityDetails.mode),
      modeName: await this.resolveModeName(activityDetails.mode),
      players: players.sort((a, b) => b.kills - a.kills),
      teams: asArray(report.teams)
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.pgcr);
    return result;
  }

  async getWeapons(membershipType: number, membershipId: string): Promise<WeaponsSummary> {
    const cacheKey = `d2:weapons:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<WeaponsSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const weaponGroups = await Promise.all(
      profile.characters.map(async (character) => {
        const response = await this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/UniqueWeapons/`
        );
        return asArray(asRecord(response).weapons);
      })
    );

    const merged = new Map<string, WeaponUsageSummary>();
    for (const value of weaponGroups.flat()) {
      const weapon = await this.toWeaponUsage(asRecord(value));
      const existing = merged.get(weapon.referenceId);
      if (existing) {
        existing.kills += weapon.kills;
        existing.precisionKills += weapon.precisionKills;
        existing.secondsUsed += weapon.secondsUsed;
      } else {
        merged.set(weapon.referenceId, weapon);
      }
    }

    const result: WeaponsSummary = {
      membershipType,
      membershipId,
      weapons: [...merged.values()].sort((a, b) => b.kills - a.kills),
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.weapons);
    return result;
  }

  async getCraftables(membershipType: number, membershipId: string): Promise<CraftablesSummary> {
    const cacheKey = `d2:craftables:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<CraftablesSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.get<unknown>(`/Destiny2/${membershipType}/Profile/${membershipId}/`, {
      query: {
        components: [...CRAFTABLES_COMPONENTS]
      }
    });
    const profileResponse = asRecord(response);
    const characterCraftables = asRecord(asRecord(profileResponse.characterCraftables).data);
    const allCraftables = mergeCharacterCraftables(characterCraftables);
    const rootNodeHash = findCraftingRootNodeHash(characterCraftables);
    const presentationGroups = await this.getCraftablePresentationGroups(rootNodeHash);
    const groups = new Map<string, CraftableWeaponGroup>();

    for (const [itemHash, craftable] of allCraftables.entries()) {
      const item = await this.toCraftableWeapon(itemHash, craftable, presentationGroups.get(itemHash));
      const key = item.groupName || "锻造武器";
      const group = groups.get(key) ?? {
        key,
        name: key,
        total: 0,
        unlocked: 0,
        locked: 0,
        items: []
      };
      group.total += 1;
      if (item.unlocked) {
        group.unlocked += 1;
      } else {
        group.locked += 1;
      }
      group.items.push(item);
      groups.set(key, group);
    }

    const sortedGroups = [...groups.values()]
      .map((group) => ({
        ...group,
        items: group.items.sort(compareCraftables)
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const result: CraftablesSummary = {
      membershipType,
      membershipId,
      totals: {
        groups: sortedGroups.length,
        weapons: sortedGroups.reduce((sum, group) => sum + group.total, 0),
        unlocked: sortedGroups.reduce((sum, group) => sum + group.unlocked, 0),
        locked: sortedGroups.reduce((sum, group) => sum + group.locked, 0)
      },
      groups: sortedGroups,
      scan: {
        characterCount: Object.keys(characterCraftables).length,
        rootNodeHash,
        note: rootNodeHash ? "分组来自 Bungie 锻造 PresentationNode" : "未返回锻造根节点，使用默认分组"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.craftables);
    return result;
  }

  async getCatalysts(membershipType: number, membershipId: string, accessToken: string): Promise<CatalystsSummary> {
    const cacheKey = `d2:catalysts:v2:${membershipType}:${membershipId}`;
    const cached = await this.cache.getJson<CatalystsSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.client.get<unknown>(`/Destiny2/${membershipType}/Profile/${membershipId}/`, {
      query: {
        components: [...CATALYST_COMPONENTS]
      },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const profileResponse = asRecord(response);
    const recordComponents = mergeProfileRecordComponents(profileResponse);
    const collectibleCount = countProfileCollectibles(profileResponse);
    const recordDefinitions = await this.manifest.getDefinitionMap<RecordDefinition>("DestinyRecordDefinition");
    const catalystPresentationRecords = await this.getCatalystPresentationRecordHashes();
    const candidateHashes = await this.getCatalystRecordCandidates(recordDefinitions, catalystPresentationRecords);
    const inventoryDefinitions = await this.safeInventoryDefinitions();
    const groups = new Map<CatalystSlot, CatalystWeaponGroup>();

    for (const recordHash of candidateHashes) {
      const definition = recordDefinitions[recordHash];
      if (!definition) {
        continue;
      }
      const item = this.toCatalystWeapon(recordHash, definition, recordComponents.get(recordHash), inventoryDefinitions);
      const group = groups.get(item.slot) ?? {
        key: item.slot,
        name: item.slotLabel,
        total: 0,
        completed: 0,
        incomplete: 0,
        items: []
      };
      group.total += 1;
      if (item.completed) {
        group.completed += 1;
      } else {
        group.incomplete += 1;
      }
      group.items.push(item);
      groups.set(item.slot, group);
    }

    const orderedGroups = CATALYST_SLOT_ORDER.map((slot) => groups.get(slot))
      .filter((group): group is CatalystWeaponGroup => Boolean(group))
      .map((group) => ({
        ...group,
        items: group.items.sort(compareCatalysts)
      }));

    const result: CatalystsSummary = {
      membershipType,
      membershipId,
      totals: {
        groups: orderedGroups.length,
        catalysts: orderedGroups.reduce((sum, group) => sum + group.total, 0),
        completed: orderedGroups.reduce((sum, group) => sum + group.completed, 0),
        incomplete: orderedGroups.reduce((sum, group) => sum + group.incomplete, 0),
        visible: orderedGroups.reduce((sum, group) => sum + group.items.filter((item) => item.visible).length, 0)
      },
      groups: orderedGroups,
      scan: {
        recordDefinitions: Object.keys(recordDefinitions).length,
        candidateRecords: candidateHashes.length,
        recordsReturned: recordComponents.size,
        collectiblesReturned: collectibleCount,
        catalystPresentationRecords: catalystPresentationRecords.size,
        note: "催化进度来自 Bungie OAuth Profile Records/Collectibles；武器归属优先使用记录奖励物品，缺失时按名称匹配。"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.catalysts);
    return result;
  }

  async getCatalystInfo(query: string): Promise<CatalystInfoSummary> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestError("q is required");
    }
    const normalizedSearch = normalizeCatalystInfoSearchText(normalizedQuery);
    if (!normalizedSearch) {
      throw new BadRequestError("q must include a weapon name");
    }
    const cacheKey = `d2:catalyst-info:v2:${normalizedSearch}`;
    const cached = await this.cache.getJson<CatalystInfoSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const recordDefinitions = await this.manifest.getDefinitionMap<RecordDefinition>("DestinyRecordDefinition");
    const catalystPresentationRecords = await this.getCatalystPresentationRecordHashes();
    const candidateHashes = await this.getCatalystRecordCandidates(recordDefinitions, catalystPresentationRecords);
    const inventoryDefinitions = await this.safeInventoryDefinitions();
    const objectiveDefinitions = await this.safeObjectiveDefinitions();
    const sandboxPerkDefinitions = await this.safeSandboxPerkDefinitions();
    const matches = candidateHashes
      .map((recordHash) => {
        const definition = recordDefinitions[recordHash];
        return definition
          ? this.toCatalystInfoMatch(
              normalizedQuery,
              recordHash,
              definition,
              inventoryDefinitions,
              objectiveDefinitions,
              sandboxPerkDefinitions
            )
          : null;
      })
      .filter((match): match is CatalystInfoMatch => Boolean(match))
      .sort((left, right) => left.match.score - right.match.score || left.weaponName.localeCompare(right.weaponName))
      .slice(0, 6);

    const result: CatalystInfoSummary = {
      query: normalizedQuery,
      total: matches.length,
      matches,
      scan: {
        recordDefinitions: Object.keys(recordDefinitions).length,
        candidateRecords: candidateHashes.length,
        catalystPresentationRecords: catalystPresentationRecords.size,
        inventoryDefinitions: Object.keys(inventoryDefinitions).length,
        objectiveDefinitions: Object.keys(objectiveDefinitions).length,
        note:
          "催化效果来自 Bungie Manifest 的 Record/Inventory/Objective 定义；这是公开静态资料，不代表玩家个人完成进度。"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.catalysts);
    return result;
  }

  async getItemInfo(query: string, limit = 6): Promise<ItemInfoSummary> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestError("q is required");
    }
    const search = normalizeItemInfoSearchText(normalizedQuery);
    if (!search) {
      throw new BadRequestError("q must include an item name");
    }
    const parsedLimit = Number.isFinite(limit) ? limit : 6;
    const resultLimit = Math.max(1, Math.min(12, Math.trunc(parsedLimit)));
    const cacheKey = `d2:item-info:v1:${search}:${resultLimit}`;
    const cached = await this.cache.getJson<ItemInfoSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const [inventoryDefinitions, statDefinitions, sandboxPerkDefinitions, craftableItems] = await Promise.all([
      this.safeInventoryDefinitions(),
      this.safeStatDefinitions(),
      this.safeSandboxPerkDefinitions(),
      this.getPublicCraftableItemHashes()
    ]);

    const basicMatches = Object.entries(inventoryDefinitions)
      .map(([itemHash, definition]) => {
        const score = itemInfoMatchScore(normalizedQuery, definition);
        return score ? { itemHash, definition, score } : null;
      })
      .filter((match): match is { itemHash: string; definition: InventoryItemDefinition; score: { score: number; reason: string } } =>
        Boolean(match)
      )
      .sort((left, right) => {
        const weaponDiff = Number(!inventoryDefinitionLooksLikeWeapon(left.definition)) - Number(!inventoryDefinitionLooksLikeWeapon(right.definition));
        return weaponDiff || left.score.score - right.score.score || itemInfoName(left.definition).localeCompare(itemInfoName(right.definition));
      })
      .slice(0, resultLimit);

    const matches = await Promise.all(
      basicMatches.map(async (match) =>
        this.toItemInfoMatch(
          match.itemHash,
          match.definition,
          match.score,
          inventoryDefinitions,
          statDefinitions,
          sandboxPerkDefinitions,
          craftableItems
        )
      )
    );

    const result: ItemInfoSummary = {
      query: normalizedQuery,
      total: matches.length,
      matches,
      scan: {
        inventoryDefinitions: Object.keys(inventoryDefinitions).length,
        statDefinitions: Object.keys(statDefinitions).length,
        craftableItems: craftableItems.size,
        note: "武器/物品详情来自 Bungie Manifest 本地缓存；不使用第三方网页数据。"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.manifestDefinition);
    return result;
  }

  async getPerkWeapons(options: {
    perks: string[] | string;
    weaponType?: string;
    slot?: string;
    damageType?: string;
    rpm?: number;
    craftable?: boolean;
    query?: string;
    limit?: number;
  }): Promise<PerkWeaponsSummary> {
    const perks = normalizePerkWeaponInputs(options.perks);
    if (perks.length === 0) {
      throw new BadRequestError("perks is required");
    }

    const limit = Math.max(1, Math.min(200, Math.trunc(Number.isFinite(options.limit) ? Number(options.limit) : 50)));
    const weaponType = normalizeInventoryWeaponType(options.weaponType);
    const slot = normalizeInventoryFilterText(options.slot);
    const damageType = normalizeInventoryFilterText(options.damageType);
    const rpm = parseInventoryRpm(options.rpm);
    const query = normalizeInventoryFilterText(options.query);
    const craftable = typeof options.craftable === "boolean" ? options.craftable : undefined;
    const cacheKey = `d2:perk-weapons:v1:${JSON.stringify({ perks, weaponType, slot, damageType, rpm, craftable, query, limit })}`;
    const cached = await this.cache.getJson<PerkWeaponsSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const [inventoryDefinitions, plugSetDefinitions, statDefinitions, craftableItems] = await Promise.all([
      this.safeInventoryDefinitions(),
      this.safePlugSetDefinitions(),
      this.safeStatDefinitions(),
      this.getPublicCraftableItemHashes()
    ]);

    const matches: PerkWeaponMatch[] = [];
    for (const [itemHash, definition] of Object.entries(inventoryDefinitions)) {
      if (!inventoryDefinitionLooksLikeWeapon(definition)) {
        continue;
      }
      if (!perkWeaponDefinitionMatchesFilters(definition, { weaponType, slot, damageType, rpm, craftable, query }, craftableItems, itemHash)) {
        continue;
      }
      const rollPerks = perkWeaponRollPerksForDefinition(definition, inventoryDefinitions, plugSetDefinitions);
      const matchedPerks = matchPerkWeaponInputs(perks, rollPerks);
      if (matchedPerks.length !== perks.length) {
        continue;
      }
      matches.push(perkWeaponMatchFromDefinition(itemHash, definition, matchedPerks, rollPerks, craftableItems, statDefinitions));
    }

    matches.sort((left, right) => {
      const craftDiff = Number(!right.craftable) - Number(!left.craftable);
      const typeDiff = String(left.itemTypeDisplayName ?? "").localeCompare(String(right.itemTypeDisplayName ?? ""));
      return craftDiff || typeDiff || left.name.localeCompare(right.name);
    });

    const result: PerkWeaponsSummary = {
      perks,
      filters: {
        ...(weaponType ? { weaponType } : {}),
        ...(slot ? { slot } : {}),
        ...(damageType ? { damageType } : {}),
        ...(rpm !== undefined ? { rpm } : {}),
        ...(craftable !== undefined ? { craftable } : {}),
        ...(query ? { query } : {}),
        limit
      },
      total: matches.length,
      matches: matches.slice(0, limit),
      scan: {
        inventoryDefinitions: Object.keys(inventoryDefinitions).length,
        plugSetDefinitions: Object.keys(plugSetDefinitions).length,
        craftableItems: craftableItems.size,
        note:
          "Perk 反查来自 Bungie Manifest 的武器 socket 和 plug set。结果表示武器 perk 池包含这些 perk，不保证当前赛季可获取。"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.manifestDefinition);
    return result;
  }

  async getCatalystStatus(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    query: string
  ): Promise<CatalystStatusSummary> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestError("q is required");
    }
    const normalizedSearch = normalizeCatalystInfoSearchText(normalizedQuery);
    if (!normalizedSearch) {
      throw new BadRequestError("q must include a weapon name");
    }

    const catalysts = await this.getCatalysts(membershipType, membershipId, accessToken);
    const infoSummaries = await Promise.all(
      catalystSearchTerms(normalizedQuery).map(async (term) => {
        try {
          return await this.getCatalystInfo(term);
        } catch {
          return null;
        }
      })
    );
    const infoMatches = uniqueCatalystInfoMatches(infoSummaries.flatMap((summary) => summary?.matches ?? []));
    const objectiveDefinitions = await this.safeObjectiveDefinitions();
    const matches = catalysts.groups
      .flatMap((group) => group.items)
      .map((item) => toCatalystStatusMatch(normalizedQuery, item, infoMatches, objectiveDefinitions))
      .filter((match): match is CatalystStatusMatch => Boolean(match))
      .sort((left, right) => left.match.score - right.match.score || left.weaponName.localeCompare(right.weaponName))
      .slice(0, 6);

    return {
      membershipType,
      membershipId,
      query: normalizedQuery,
      total: matches.length,
      totals: {
        obtained: matches.filter((match) => match.obtained).length,
        visible: matches.filter((match) => match.visible).length,
        completed: matches.filter((match) => match.completed).length
      },
      matches,
      scan: {
        candidateRecords: catalysts.scan.candidateRecords,
        recordsReturned: catalysts.scan.recordsReturned,
        catalystInfoMatches: infoMatches.length,
        note: "单武器催化状态来自 QQ OAuth Profile Records/Collectibles；催化效果来自公开 Manifest 定义。"
      },
      updatedAt: new Date().toISOString()
    };
  }

  async getPrivateInventory(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    qq?: string
  ): Promise<InventorySummary> {
    const response = await this.getPrivateProfile(membershipType, membershipId, accessToken, PRIVATE_INVENTORY_COMPONENTS);
    return this.toInventorySummary(membershipType, membershipId, response, qq);
  }

  async searchPrivateInventory(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    options: {
      qq?: string;
      query?: string;
      bucket: InventoryBucketFilter;
      characterId?: string;
      weaponType?: string;
      rpm?: number;
      slot?: string;
      damageType?: string;
      perk?: string;
    }
  ): Promise<InventorySearchSummary> {
    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, options.qq);
    const criteria = inventorySearchCriteria(options);
    const searchQueries = inventorySearchCandidates(criteria.query);
    const characterId = options.characterId;
    const items = inventory.items.filter((item) => {
      if (options.bucket !== "all" && item.owner !== options.bucket) {
        return false;
      }
      if (characterId && item.characterId !== characterId) {
        return false;
      }
      if (!inventoryItemMatchesStructuredSearch(item, criteria)) {
        return false;
      }
      if (searchQueries.length === 0) {
        return true;
      }
      const itemText = inventoryItemSearchText(item);
      return searchQueries.some((query) => itemText.includes(query));
    });

    return {
      qq: options.qq,
      membershipType,
      membershipId,
      query: criteria.query,
      bucket: options.bucket,
      ...(characterId ? { characterId } : {}),
      ...(criteria.weaponType ? { weaponType: criteria.weaponType } : {}),
      ...(criteria.rpm !== undefined ? { rpm: criteria.rpm } : {}),
      ...(criteria.slot ? { slot: criteria.slot } : {}),
      ...(criteria.damageType ? { damageType: criteria.damageType } : {}),
      ...(criteria.perk ? { perk: criteria.perk } : {}),
      items,
      total: items.length,
      updatedAt: new Date().toISOString()
    };
  }

  async transferInventoryItems(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: InventoryTransferItemsRequest
  ): Promise<InventoryTransferItemsSummary> {
    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, request.qq);
    const transferRequest = resolveInventoryTransferCharacters(inventory, request);
    const { plannedItems, skippedItems } = buildInventoryTransferPlan(inventory, transferRequest);
    const results: InventoryTransferItemResult[] = [
      ...skippedItems,
      ...plannedItems.map((item) => toInventoryTransferItemResult(item, transferRequest, "planned"))
    ];

    if (transferRequest.mode === "execute") {
      for (const item of plannedItems) {
        const resultIndex = results.findIndex(
          (entry) => entry.status === "planned" && entry.itemId === item.itemInstanceId
        );
        try {
          const responses: unknown[] = [];
          if (transferRequest.destination.owner === "vault") {
            const transfer = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
              qq: transferRequest.qq,
              itemReferenceHash: item.itemHash,
              stackSize: Math.max(1, item.quantity || 1),
              transferToVault: true,
              itemId: requireInventoryItemInstanceId(item),
              characterId: requireInventoryItemCharacterId(item)
            });
            responses.push(transfer.bungieResponse);
          } else {
            const destinationCharacterId = requireTransferDestinationCharacterId(transferRequest);
            if (item.owner === "vault") {
              const transfer = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
                qq: transferRequest.qq,
                itemReferenceHash: item.itemHash,
                stackSize: Math.max(1, item.quantity || 1),
                transferToVault: false,
                itemId: requireInventoryItemInstanceId(item),
                characterId: destinationCharacterId
              });
              responses.push(transfer.bungieResponse);
            } else {
              const toVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
                qq: transferRequest.qq,
                itemReferenceHash: item.itemHash,
                stackSize: Math.max(1, item.quantity || 1),
                transferToVault: true,
                itemId: requireInventoryItemInstanceId(item),
                characterId: requireInventoryItemCharacterId(item)
              });
              responses.push(toVault.bungieResponse);
              const fromVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
                qq: transferRequest.qq,
                itemReferenceHash: item.itemHash,
                stackSize: Math.max(1, item.quantity || 1),
                transferToVault: false,
                itemId: requireInventoryItemInstanceId(item),
                characterId: destinationCharacterId
              });
              responses.push(fromVault.bungieResponse);
            }
          }
          const moved = toInventoryTransferItemResult(item, transferRequest, "moved");
          moved.bungieResponse = responses.length === 1 ? responses[0] : responses;
          if (resultIndex >= 0) {
            results[resultIndex] = moved;
          } else {
            results.push(moved);
          }
        } catch (error) {
          const failed = toInventoryTransferItemResult(item, transferRequest, "failed", friendlyTransferItemError(error));
          failed.bungieErrorCode = (error as { bungieErrorCode?: unknown }).bungieErrorCode;
          failed.bungieErrorStatus = (error as { bungieErrorStatus?: unknown }).bungieErrorStatus;
          if (resultIndex >= 0) {
            results[resultIndex] = failed;
          } else {
            results.push(failed);
          }
        }
      }
    }

    const moved = results.filter((item) => item.status === "moved").length;
    const failed = results.filter((item) => item.status === "failed").length;
    const skipped = results.filter((item) => item.status === "skipped").length;
    const planned = plannedItems.length;
    const errors = results
      .filter((item) => item.status === "failed" || item.status === "skipped")
      .map((item) => ({
        itemId: item.itemId,
        name: item.name,
        message: item.message,
        code: item.bungieErrorCode,
        status: item.bungieErrorStatus
      }));
    const message =
      transferRequest.mode === "preview"
        ? `将移动 ${planned} 件物品，跳过 ${skipped} 件。`
        : `移动完成：成功 ${moved} 件，失败 ${failed} 件，跳过 ${skipped} 件。`;

    return {
      qq: transferRequest.qq,
      membershipType,
      membershipId,
      action: "transferItems",
      mode: transferRequest.mode,
      ok: failed === 0,
      planned,
      moved,
      failed,
      skipped,
      source: transferRequest.source,
      destination: transferRequest.destination,
      filters: transferRequest.filters,
      maxItems: transferRequest.maxItems,
      items: results,
      errors,
      message,
      updatedAt: new Date().toISOString()
    };
  }

  async transferInventoryItem(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: {
      qq?: string;
      itemReferenceHash: number;
      stackSize: number;
      transferToVault: boolean;
      itemId: string;
      characterId: string;
    }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Items/TransferItem/", {
      headers: oauthHeaders(accessToken),
      body: {
        itemReferenceHash: request.itemReferenceHash,
        stackSize: request.stackSize,
        transferToVault: request.transferToVault,
        itemId: request.itemId,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "transfer",
      ok: true,
      itemId: request.itemId,
      itemHash: request.itemReferenceHash,
      characterId: request.characterId,
      bungieResponse: response,
      message: request.transferToVault ? "已移动到仓库" : "已移动到角色",
      updatedAt: new Date().toISOString()
    };
  }

  async equipInventoryItem(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; itemId: string; characterId: string }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Items/EquipItem/", {
      headers: oauthHeaders(accessToken),
      body: {
        itemId: request.itemId,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "equip",
      ok: true,
      itemId: request.itemId,
      characterId: request.characterId,
      bungieResponse: response,
      message: "已装备物品",
      updatedAt: new Date().toISOString()
    };
  }

  async equipInventoryItems(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; itemIds: string[]; characterId: string }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Items/EquipItems/", {
      headers: oauthHeaders(accessToken),
      body: {
        itemIds: request.itemIds,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "equipItems",
      ok: true,
      itemIds: request.itemIds,
      characterId: request.characterId,
      bungieResponse: response,
      message: "已批量装备物品",
      updatedAt: new Date().toISOString()
    };
  }

  async setInventoryItemLockState(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; itemId: string; characterId: string; state: boolean }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Items/SetLockState/", {
      headers: oauthHeaders(accessToken),
      body: {
        state: request.state,
        itemId: request.itemId,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "lock",
      ok: true,
      itemId: request.itemId,
      characterId: request.characterId,
      bungieResponse: response,
      message: request.state ? "已锁定物品" : "已解锁物品",
      updatedAt: new Date().toISOString()
    };
  }

  async getLoadouts(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    qq?: string
  ): Promise<LoadoutsSummary> {
    const response = await this.getPrivateProfile(membershipType, membershipId, accessToken, PRIVATE_INVENTORY_COMPONENTS);
    const profileResponse = asRecord(response);
    const charactersData = asRecord(asRecord(profileResponse.characters).data);
    const characters = await Promise.all(
      Object.entries(charactersData).map(([characterId, value]) =>
        this.toCharacterSummary(characterId, asRecord(value))
      )
    );
    const loadoutData = asRecord(asRecord(profileResponse.characterLoadouts).data);
    const loadouts = Object.entries(loadoutData).flatMap(([characterId, value]) => {
      const entries = asArray(asRecord(value).loadouts);
      return entries.map((entry, index) => {
        const record = asRecord(entry);
        return {
          index: optionalNumber(record.index) ?? index,
          characterId,
          name: optionalString(record.name),
          colorHash: optionalNumber(record.colorHash),
          iconHash: optionalNumber(record.iconHash),
          itemCount: asArray(record.items).length,
          raw: record
        };
      });
    });

    return {
      qq,
      membershipType,
      membershipId,
      characters,
      loadouts,
      savedLoadouts: qq ? (await this.store.listSavedLoadouts(qq)).map(savedLoadoutRowToSummary) : [],
      updatedAt: new Date().toISOString()
    };
  }

  async equipLoadout(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; characterId: string; loadoutIndex: number }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Loadouts/EquipLoadout/", {
      headers: oauthHeaders(accessToken),
      body: {
        loadoutIndex: request.loadoutIndex,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "equipLoadout",
      ok: true,
      characterId: request.characterId,
      loadoutIndex: request.loadoutIndex,
      bungieResponse: response,
      message: "已装备游戏内 Loadout",
      updatedAt: new Date().toISOString()
    };
  }

  async snapshotLoadout(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; characterId: string; loadoutIndex: number }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Loadouts/SnapshotLoadout/", {
      headers: oauthHeaders(accessToken),
      body: {
        loadoutIndex: request.loadoutIndex,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "snapshotLoadout",
      ok: true,
      characterId: request.characterId,
      loadoutIndex: request.loadoutIndex,
      bungieResponse: response,
      message: "已把当前装备保存到游戏内 Loadout 槽",
      updatedAt: new Date().toISOString()
    };
  }

  async updateLoadoutIdentifiers(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: {
      qq?: string;
      characterId: string;
      loadoutIndex: number;
      colorHash?: number;
      iconHash?: number;
      nameHash?: number;
    }
  ): Promise<InventoryActionResult> {
    if (request.colorHash === undefined && request.iconHash === undefined && request.nameHash === undefined) {
      throw new BadRequestError("at least one of colorHash, iconHash, or nameHash is required");
    }
    const response = await this.client.post<unknown>("/Destiny2/Actions/Loadouts/UpdateLoadoutIdentifiers/", {
      headers: oauthHeaders(accessToken),
      body: {
        loadoutIndex: request.loadoutIndex,
        characterId: request.characterId,
        membershipType,
        ...(request.colorHash !== undefined ? { colorHash: request.colorHash } : {}),
        ...(request.iconHash !== undefined ? { iconHash: request.iconHash } : {}),
        ...(request.nameHash !== undefined ? { nameHash: request.nameHash } : {})
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "updateLoadoutIdentifiers",
      ok: true,
      characterId: request.characterId,
      loadoutIndex: request.loadoutIndex,
      bungieResponse: response,
      message: "已更新游戏内 Loadout 标识",
      updatedAt: new Date().toISOString()
    };
  }

  async clearLoadout(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq?: string; characterId: string; loadoutIndex: number }
  ): Promise<InventoryActionResult> {
    const response = await this.client.post<unknown>("/Destiny2/Actions/Loadouts/ClearLoadout/", {
      headers: oauthHeaders(accessToken),
      body: {
        loadoutIndex: request.loadoutIndex,
        characterId: request.characterId,
        membershipType
      }
    });
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      action: "clearLoadout",
      ok: true,
      characterId: request.characterId,
      loadoutIndex: request.loadoutIndex,
      bungieResponse: response,
      message: "已清空游戏内 Loadout 槽",
      updatedAt: new Date().toISOString()
    };
  }

  async saveLocalLoadout(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: {
      qq: string;
      name: string;
      characterId?: string;
      source?: string;
      optimizerSessionId?: string;
      optimizerBuildId?: string;
      notes?: string;
      overwrite: boolean;
    }
  ): Promise<SavedLoadoutSummary> {
    const name = normalizeSavedLoadoutName(request.name);
    const existing = await this.store.getSavedLoadout(request.qq, name);
    if (existing && !request.overwrite) {
      throw new BadRequestError("saved loadout already exists; pass overwrite=true to replace it", { name });
    }

    if (request.optimizerSessionId && request.optimizerBuildId) {
      const cached = await this.cache.getJson<LoadoutOptimizerSearchSummary>(
        optimizerSessionCacheKey(request.qq, request.optimizerSessionId)
      );
      if (!cached || cached.qq !== request.qq || cached.membershipType !== membershipType || cached.membershipId !== membershipId) {
        throw new NotFoundError("loadout optimizer session was not found or expired");
      }
      const build = cached.builds.find((entry) => entry.buildId === request.optimizerBuildId);
      if (!build) {
        throw new NotFoundError("loadout optimizer build was not found");
      }
      const row = await this.store.upsertSavedLoadout(
        {
          qq: request.qq,
          name,
          className: cached.className,
          characterId: cached.characterId,
          source: request.source || "optimizer",
          items: build.armor.map((item) => optimizerArmorToInventorySnapshot(item)),
          statMods: build.statMods,
          fragments: build.fragments,
          notes: request.notes
        },
        request.overwrite
      );
      return savedLoadoutRowToSummary(row);
    }

    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, request.qq);
    const character = selectSavedLoadoutCharacter(inventory.characters, request.characterId);
    if (!character) {
      throw new BadRequestError("characterId was not found on this account");
    }
    const items = inventory.items.filter(
      (item) =>
        item.owner === "equipped" &&
        item.characterId === character.characterId &&
        item.itemInstanceId &&
        isSavedLoadoutGearItem(item)
    );
    if (!items.length) {
      throw new BadRequestError("selected character has no equipped items to save");
    }
    const row = await this.store.upsertSavedLoadout(
      {
        qq: request.qq,
        name,
        className: character.className,
        characterId: character.characterId,
        source: request.source || "current_equipped",
        items: items.map(savedInventoryItemSnapshot),
        statMods: [],
        fragments: [],
        notes: request.notes
      },
      request.overwrite
    );
    return savedLoadoutRowToSummary(row);
  }

  async getSavedLoadout(qq: string, idOrName: string): Promise<SavedLoadoutSummary> {
    const row = await this.store.getSavedLoadout(qq, idOrName);
    if (!row) {
      throw new NotFoundError("saved loadout was not found");
    }
    return savedLoadoutRowToSummary(row);
  }

  async listSavedLoadouts(qq: string): Promise<SavedLoadoutSummary[]> {
    return (await this.store.listSavedLoadouts(qq)).map(savedLoadoutRowToSummary);
  }

  async applySavedLoadout(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq: string; idOrName: string; characterId?: string; confirm: boolean }
  ): Promise<SavedLoadoutApplyResult> {
    if (!request.confirm) {
      throw new BadRequestError("confirm must be true to apply a saved loadout");
    }
    const row = await this.store.getSavedLoadout(request.qq, request.idOrName);
    if (!row) {
      throw new NotFoundError("saved loadout was not found");
    }
    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, request.qq);
    const character = selectSavedLoadoutCharacter(inventory.characters, request.characterId || row.characterId);
    if (!character) {
      throw new BadRequestError("target character was not found on this account");
    }

    const savedItems = Array.isArray(row.items) ? row.items.map((item) => asRecord(item)) : [];
    const currentByInstanceId = new Map(
      inventory.items
        .filter((item) => item.itemInstanceId)
        .map((item) => [String(item.itemInstanceId), item])
    );
    const missingItemIds: string[] = [];
    const itemsToEquip: InventoryItemSummary[] = [];
    for (const savedItem of savedItems) {
      const itemInstanceId = optionalString(savedItem.itemInstanceId);
      if (!itemInstanceId) {
        continue;
      }
      const current = currentByInstanceId.get(itemInstanceId);
      if (!current) {
        missingItemIds.push(itemInstanceId);
        continue;
      }
      if (current.canEquip && isSavedLoadoutGearItem(current)) {
        itemsToEquip.push(current);
      }
    }
    if (missingItemIds.length) {
      throw new BadRequestError("saved loadout contains items that are no longer available", { missingItemIds });
    }
    if (!itemsToEquip.length) {
      throw new BadRequestError("saved loadout has no equippable items");
    }

    const transferredItemIds: string[] = [];
    const bungieResponses: unknown[] = [];
    for (const item of itemsToEquip) {
      const itemInstanceId = item.itemInstanceId;
      if (!itemInstanceId) {
        continue;
      }
      if (item.owner === "vault") {
        const transfer = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: false,
          itemId: itemInstanceId,
          characterId: character.characterId
        });
        transferredItemIds.push(itemInstanceId);
        bungieResponses.push(transfer.bungieResponse);
      } else if (item.characterId && item.characterId !== character.characterId) {
        const toVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: true,
          itemId: itemInstanceId,
          characterId: item.characterId
        });
        const fromVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: false,
          itemId: itemInstanceId,
          characterId: character.characterId
        });
        transferredItemIds.push(itemInstanceId);
        bungieResponses.push(toVault.bungieResponse, fromVault.bungieResponse);
      }
    }

    const equippedItemIds = itemsToEquip.map((item) => String(item.itemInstanceId)).filter(Boolean);
    const equip = await this.equipInventoryItems(membershipType, membershipId, accessToken, {
      qq: request.qq,
      itemIds: equippedItemIds,
      characterId: character.characterId
    });
    bungieResponses.push(equip.bungieResponse);
    await this.store.touchSavedLoadoutApplied(request.qq, row.id);
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      savedLoadoutId: row.id,
      savedLoadoutName: row.name,
      characterId: character.characterId,
      transferredItemIds,
      equippedItemIds,
      missingItemIds,
      statMods: savedLoadoutRowToSummary(row).statMods,
      fragments: savedLoadoutRowToSummary(row).fragments,
      bungieResponses,
      message: `已应用本地保存配装：${row.name}。模组、碎片、皮肤和染色请按保存信息手动调整。`,
      updatedAt: new Date().toISOString()
    };
  }

  async searchLoadoutOptimizer(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: {
      qq?: string;
      className: string;
      targetStats?: Record<string, unknown>;
      includeCurrentSubclassFragments?: boolean;
      simulateStatMods?: boolean;
      limit?: number;
    }
  ): Promise<LoadoutOptimizerSearchSummary> {
    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, request.qq);
    const classType = normalizeOptimizerClassType(request.className);
    const character = selectOptimizerCharacter(inventory.characters, classType);
    if (!character) {
      throw new BadRequestError("selected class was not found on this account", { className: request.className });
    }
    const targets = normalizeOptimizerTargets(request.targetStats);
    const includeCurrentSubclassFragments = request.includeCurrentSubclassFragments !== false;
    const simulateStatMods = request.simulateStatMods !== false;
    const limit = clampIntegerValue(request.limit, 3, 1, 10);
    const search = buildOptimizerSearch(inventory, character, targets, {
      includeCurrentSubclassFragments,
      simulateStatMods,
      limit
    });
    const sessionId = randomBytes(12).toString("hex");
    const result: LoadoutOptimizerSearchSummary = {
      qq: request.qq,
      membershipType,
      membershipId,
      sessionId,
      className: character.className,
      classType: character.classType,
      characterId: character.characterId,
      targets,
      options: {
        includeCurrentSubclassFragments,
        simulateStatMods,
        limit
      },
      ...search,
      updatedAt: new Date().toISOString()
    };
    await this.cache.setJson(optimizerSessionCacheKey(request.qq, sessionId), result, LOADOUT_OPTIMIZER_SESSION_TTL_SECONDS);
    return result;
  }

  async applyLoadoutOptimizerBuild(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    request: { qq: string; sessionId: string; buildId: string; characterId?: string; confirm: boolean }
  ): Promise<LoadoutOptimizerApplyResult> {
    if (!request.confirm) {
      throw new BadRequestError("confirm must be true to apply a loadout optimizer build");
    }
    const cached = await this.cache.getJson<LoadoutOptimizerSearchSummary>(
      optimizerSessionCacheKey(request.qq, request.sessionId)
    );
    if (!cached || cached.qq !== request.qq || cached.membershipType !== membershipType || cached.membershipId !== membershipId) {
      throw new NotFoundError("loadout optimizer session was not found or expired");
    }
    const build = cached.builds.find((entry) => entry.buildId === request.buildId);
    if (!build) {
      throw new NotFoundError("loadout optimizer build was not found");
    }
    const characterId = request.characterId || cached.characterId;
    if (characterId !== cached.characterId) {
      throw new BadRequestError("characterId does not match the optimizer session");
    }

    const transferredItemIds: string[] = [];
    const bungieResponses: unknown[] = [];
    for (const item of build.armor) {
      if (item.owner === "vault") {
        const transfer = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: false,
          itemId: item.itemInstanceId,
          characterId
        });
        transferredItemIds.push(item.itemInstanceId);
        bungieResponses.push(transfer.bungieResponse);
      } else if (item.owner === "inventory" && item.characterId && item.characterId !== characterId) {
        const toVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: true,
          itemId: item.itemInstanceId,
          characterId: item.characterId
        });
        const fromVault = await this.transferInventoryItem(membershipType, membershipId, accessToken, {
          qq: request.qq,
          itemReferenceHash: item.itemHash,
          stackSize: 1,
          transferToVault: false,
          itemId: item.itemInstanceId,
          characterId
        });
        transferredItemIds.push(item.itemInstanceId);
        bungieResponses.push(toVault.bungieResponse, fromVault.bungieResponse);
      }
    }

    const equippedItemIds = build.armor.map((item) => item.itemInstanceId);
    const equip = await this.equipInventoryItems(membershipType, membershipId, accessToken, {
      qq: request.qq,
      itemIds: equippedItemIds,
      characterId
    });
    bungieResponses.push(equip.bungieResponse);
    return {
      qq: request.qq,
      membershipType,
      membershipId,
      sessionId: request.sessionId,
      buildId: request.buildId,
      characterId,
      transferredItemIds,
      equippedItemIds,
      statMods: build.statMods,
      fragments: build.fragments,
      bungieResponses,
      message: "已应用配装防具；属性模组和碎片请按推荐图手动调整。",
      updatedAt: new Date().toISOString()
    };
  }

  async getRaidOverview(
    membershipType: number,
    membershipId: string,
    options: { historyPages: number; pgcrLimit: number }
  ): Promise<RaidOverview> {
    const cacheKey = `d2:raid-overview:${membershipType}:${membershipId}:${options.historyPages}:${options.pgcrLimit}`;
    const cached = await this.cache.getJson<RaidOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const activityDefinitions = await this.manifest.getDefinitionMap<RaidActivityDefinition>(
      "DestinyActivityDefinition"
    );
    const aggregateResults = await Promise.allSettled(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );
    const aggregateResponses = aggregateResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const aggregateErrors = aggregateResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${profile.characters[index]?.characterId ?? "unknown"}: ${scanErrorMessage(result.reason)}`]
        : []
    );
    const aggregateStatsAvailable = aggregateResponses.length > 0;

    const groups = new Map<string, RaidOverviewGroup>();
    for (const response of aggregateResponses) {
      for (const activity of asArray(asRecord(response).activities)) {
        this.addAggregateRaidActivity(groups, asRecord(activity), activityDefinitions);
      }
    }

    const recentActivities = await this.getRecentRaidActivitiesForScan(
      membershipType,
      membershipId,
      profile.characters.map((character) => character.characterId),
      options.historyPages,
      activityDefinitions
    );

    for (const activity of recentActivities) {
      const group = this.groupForActivity(groups, activity.referenceId, activity.activityName, activityDefinitions);
      if (!group) {
        continue;
      }
      const completed = statBasicValue(activity.values, "completed") > 0;
      if (completed && (!group.lastClearedAt || activity.period > group.lastClearedAt)) {
        group.lastClearedAt = activity.period;
        group.lastActivityId = activity.activityId;
      }
      if (!aggregateStatsAvailable && completed) {
        group.completions += 1;
        group.fullClears += 1;
        group.wins = group.fullClears;
        group.kills += statBasicValue(activity.values, "kills");
        group.deaths += statBasicValue(activity.values, "deaths");
        group.secondsPlayed +=
          statBasicValue(activity.values, "activityDurationSeconds") || statBasicValue(activity.values, "secondsPlayed");
      }
    }

    const completedActivities = recentActivities
      .filter((activity) => statBasicValue(activity.values, "completed") > 0)
      .filter(uniqueActivity())
      .slice(0, options.pgcrLimit);

    const scannedGroupNames = new Set<string>();
    const pgcrResults = await mapLimit(completedActivities, 5, async (activity) => {
      try {
        const pgcr = await this.getPgcr(activity.activityId);
        return { activity, pgcr };
      } catch {
        return null;
      }
    });

    let pgcrScanned = 0;
    for (const result of pgcrResults) {
      if (!result) {
        continue;
      }
      pgcrScanned += 1;
      const group = this.groupForActivity(groups, result.activity.referenceId, result.pgcr.activityName, activityDefinitions);
      if (!group) {
        continue;
      }
      scannedGroupNames.add(group.name);
      this.applyRaidPgcrScan(group, result.pgcr, membershipId);
    }

    for (const group of groups.values()) {
      if (scannedGroupNames.has(group.name)) {
        if (!group.flawless.personal && group.flawless.status === "unknown") {
          group.flawless.status = "not_found_in_scanned_pgcr";
        }
        if (group.dayOne.releaseAt && group.dayOne.status === "unknown") {
          group.dayOne.status = "not_found_in_scanned_pgcr";
        }
      }
    }

    const raids = [...groups.values()]
      .map(finalizeRaidGroup)
      .filter((raid) => raid.clears > 0 || raid.completions > 0 || raid.scannedCompletions > 0)
      .sort((a, b) => b.sortOrder - a.sortOrder || difficultySort(a.difficulty) - difficultySort(b.difficulty) || a.name.localeCompare(b.name));

    const result: RaidOverview = {
      membershipType,
      membershipId,
      totals: {
        raids: raids.length,
        clears: raids.reduce((sum, raid) => sum + raid.clears, 0),
        completions: raids.reduce((sum, raid) => sum + raid.completions, 0),
        sherpaCompletions: raids.reduce((sum, raid) => sum + raid.sherpaCompletions, 0),
        kills: raids.reduce((sum, raid) => sum + raid.kills, 0),
        deaths: raids.reduce((sum, raid) => sum + raid.deaths, 0),
        secondsPlayed: raids.reduce((sum, raid) => sum + raid.secondsPlayed, 0)
      },
      raids,
      scan: {
        historyPages: options.historyPages,
        pgcrLimit: options.pgcrLimit,
        aggregateStatsAvailable,
        aggregateCharactersScanned: aggregateResponses.length,
        ...(aggregateErrors.length > 0 ? { aggregateErrors } : {}),
        recentActivitiesScanned: recentActivities.length,
        pgcrScanned,
        note: aggregateStatsAvailable
          ? "fullClears/completions/fastest are all-time aggregate stats; sherpa/flawless/dayOne/solo/trio are only confirmed from scanned recent PGCRs"
          : "Bungie aggregate raid stats are unavailable right now; counts are best-effort from recent activity history and scanned PGCRs"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.raidOverview);
    return result;
  }

  private async getActivityModeOverview(
    membershipType: number,
    membershipId: string,
    modeValue: PublicMode,
    options: { historyPages: number }
  ): Promise<ActivityModeOverview> {
    const mode = parsePublicMode(modeValue);
    if (mode.bungieMode === undefined) {
      throw new BadRequestError("Activity overview requires a concrete Bungie mode");
    }

    const cacheKey = `d2:activity-overview:${mode.publicMode}:${membershipType}:${membershipId}:${options.historyPages}`;
    const cached = await this.cache.getJson<ActivityModeOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const activityDefinitions = await this.manifest.getDefinitionMap<RaidActivityDefinition>(
      "DestinyActivityDefinition"
    );
    const aggregateResponses = await Promise.all(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );

    const groups = new Map<string, ActivityOverviewGroup>();
    for (const response of aggregateResponses) {
      for (const activity of asArray(asRecord(response).activities)) {
        this.addAggregateModeActivity(groups, asRecord(activity), activityDefinitions, mode.bungieMode);
      }
    }

    const recentActivities = await this.getRecentModeActivitiesForScan(
      membershipType,
      membershipId,
      profile.characters.map((character) => character.characterId),
      mode,
      options.historyPages,
      activityDefinitions
    );

    for (const activity of recentActivities) {
      const group = this.groupForModeActivity(groups, activity.referenceId, activity.activityName, activityDefinitions, mode.bungieMode);
      if (!group) {
        continue;
      }
      const completed = statBasicValue(activity.values, "completed") > 0;
      if (completed && (!group.lastClearedAt || activity.period > group.lastClearedAt)) {
        group.lastClearedAt = activity.period;
        group.lastActivityId = activity.activityId;
      }
    }

    const activities = [...groups.values()]
      .map(finalizeActivityGroup)
      .filter((activity) => activity.clears > 0 || activity.completions > 0)
      .sort((a, b) => b.clears - a.clears || a.name.localeCompare(b.name));

    const result: ActivityModeOverview = {
      membershipType,
      membershipId,
      mode: mode.publicMode,
      modeLabel: mode.label,
      totals: {
        activities: activities.length,
        clears: activities.reduce((sum, activity) => sum + activity.clears, 0),
        kills: activities.reduce((sum, activity) => sum + activity.kills, 0),
        deaths: activities.reduce((sum, activity) => sum + activity.deaths, 0),
        secondsPlayed: activities.reduce((sum, activity) => sum + activity.secondsPlayed, 0)
      },
      activities,
      scan: {
        historyPages: options.historyPages,
        recentActivitiesScanned: recentActivities.length,
        note: "clears/fastest are all-time aggregate stats; lastClear is checked from recent public activity history"
      },
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.activityOverview);
    return result;
  }

  private async getCharacterActivities(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: ModeInfo,
    count: number,
    page: number
  ): Promise<ActivitySummary[]> {
    const response = await this.client.get<unknown>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/`,
      {
        query: {
          count,
          page,
          ...(mode.bungieMode === undefined ? {} : { mode: mode.bungieMode })
        }
      }
    );

    return Promise.all(
      asArray(asRecord(response).activities).map((activity) =>
        this.toActivitySummary(characterId, asRecord(activity))
      )
    );
  }

  private async getCharacterHeatmapActivities(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: ModeInfo,
    maxPages: number,
    range: HeatmapRange
  ): Promise<{ activities: ActivitySummary[]; pagesScanned: number; truncated: boolean; partial?: boolean; error?: string }> {
    if (range === "recent") {
      const settledPages = await Promise.allSettled(
        Array.from({ length: maxPages }, (_, page) =>
          this.getCharacterActivities(membershipType, membershipId, characterId, mode, RAID_HISTORY_PAGE_SIZE, page)
        )
      );
      const pages = settledPages
        .filter((result): result is PromiseFulfilledResult<ActivitySummary[]> => result.status === "fulfilled")
        .map((result) => result.value);
      const errors = settledPages
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => heatmapErrorMessage(result.reason));
      return {
        activities: pages.flat(),
        pagesScanned: maxPages,
        truncated: false,
        ...(errors.length > 0 ? { partial: true, error: [...new Set(errors)].join("; ") } : {})
      };
    }

    const activities: ActivitySummary[] = [];
    let pagesScanned = 0;
    for (let page = 0; page < maxPages; page += 1) {
      let pageActivities: ActivitySummary[];
      try {
        pageActivities = await this.getCharacterActivities(
          membershipType,
          membershipId,
          characterId,
          mode,
          RAID_HISTORY_PAGE_SIZE,
          page
        );
      } catch (error) {
        return {
          activities,
          pagesScanned,
          truncated: false,
          partial: true,
          error: heatmapErrorMessage(error)
        };
      }
      pagesScanned += 1;
      if (pageActivities.length === 0) {
        return { activities, pagesScanned, truncated: false };
      }
      activities.push(...pageActivities);
    }

    return { activities, pagesScanned, truncated: true };
  }

  private async toCharacterSummary(characterId: string, character: Record<string, unknown>): Promise<CharacterSummary> {
    const classHash = optionalNumber(character.classHash) ?? optionalString(character.classHash);
    const className = await this.manifest.getDisplayName(
      "DestinyClassDefinition",
      classHash,
      this.fallbackClassName(asNumber(character.classType))
    );

    return {
      characterId,
      classType: asNumber(character.classType),
      className,
      light: asNumber(character.light),
      emblemPath: optionalString(character.emblemPath),
      emblemBackgroundPath: optionalString(character.emblemBackgroundPath),
      dateLastPlayed: optionalString(character.dateLastPlayed),
      minutesPlayedTotal: numberFrom(character.minutesPlayedTotal)
    };
  }

  private async getHistoricalStatsSummary(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: CareerModeInfo | ModeInfo
  ): Promise<CareerModeSummary> {
    const response = await this.client.get<unknown>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/`,
      {
        query: {
          periodType: "AllTime",
          groups: "General",
          ...(mode.bungieMode === undefined ? {} : { modes: mode.bungieMode })
        }
      }
    );

    return {
      membershipType,
      membershipId,
      mode: "mode" in mode ? mode.mode : mode.publicMode,
      modeLabel: mode.label,
      icon: "icon" in mode ? mode.icon : undefined,
      tone: "tone" in mode ? mode.tone : undefined,
      stats: summarizeHistoricalStats(response),
      updatedAt: new Date().toISOString()
    };
  }

  private async getSafeHistoricalStatsSummary(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: CareerModeInfo
  ): Promise<CareerModeSummary> {
    try {
      return await this.getHistoricalStatsSummary(membershipType, membershipId, characterId, mode);
    } catch {
      return emptyCareerModeSummary(membershipType, membershipId, mode);
    }
  }

  private async getCareerSeasons(): Promise<CareerSummary["seasons"]> {
    try {
      const definitions = await this.manifest.getDefinitionMap<SeasonDefinition>("DestinySeasonDefinition");
      const now = Date.now();
      return Object.entries(definitions)
        .map(([hashIdentifier, definition]) => toCareerSeason(hashIdentifier, definition, now))
        .filter((season): season is NonNullable<ReturnType<typeof toCareerSeason>> => season !== null)
        .sort(compareCareerSeasons)
        .slice(-24);
    } catch {
      return [];
    }
  }

  private async toActivitySummary(characterId: string, activity: Record<string, unknown>): Promise<ActivitySummary> {
    const activityDetails = asRecord(activity.activityDetails);
    const referenceId = optionalNumber(activityDetails.referenceId);
    const mode = optionalNumber(activityDetails.mode);

    return {
      period: asString(activity.period),
      activityId: asString(activityDetails.instanceId),
      referenceId,
      activityName: await this.manifest.getDisplayName(
        "DestinyActivityDefinition",
        referenceId,
        `Activity ${referenceId}`
      ),
      mode,
      modeName: await this.resolveModeName(mode),
      characterId,
      values: asRecord(activity.values)
    };
  }

  private async toPgcrPlayer(entry: Record<string, unknown>): Promise<PgcrPlayerSummary> {
    const player = asRecord(entry.player);
    const destinyUserInfo = asRecord(player.destinyUserInfo);
    const membershipId = optionalString(destinyUserInfo.membershipId);
    const values = aggregatePgcrPlayerValues(entry.values);
    const extended = asRecord(entry.extended);
    const weapons = await Promise.all(
      asArray(extended.weapons).map((weapon) => this.toWeaponUsage(asRecord(weapon)))
    );

    return {
      displayName:
        asString(destinyUserInfo.bungieGlobalDisplayName) ||
        asString(destinyUserInfo.displayName) ||
        asString(player.displayName) ||
        fallbackPgcrDisplayName(membershipId),
      membershipType: optionalNumber(destinyUserInfo.membershipType),
      membershipId,
      characterId: optionalString(entry.characterId),
      emblemPath: optionalString(player.emblemPath) ?? optionalString(destinyUserInfo.iconPath),
      team: optionalNumber(entry.team),
      standing: optionalNumber(entry.standing),
      ...values,
      weapons: weapons.sort((a, b) => b.kills - a.kills)
    };
  }

  private toPvpMatchSummary(pgcr: PgcrSummary, membershipId: string): PvpMatchSummary | null {
    const ownEntries = pgcr.players.filter((player) => player.membershipId === membershipId);
    if (ownEntries.length === 0) {
      return null;
    }

    const own = combinePgcrPlayers(ownEntries);
    const team = firstDefined(ownEntries.map((player) => player.team));
    const standing = firstDefined(ownEntries.map((player) => player.standing));
    const teamPlayers = team === undefined ? ownEntries : pgcr.players.filter((player) => player.team === team);
    const opponentPlayers = team === undefined ? pgcr.players.filter((player) => player.membershipId !== membershipId) : pgcr.players.filter((player) => player.team !== team);
    const result = standing === 0 ? "win" : standing === 1 ? "loss" : "unknown";
    const weapons = aggregateMatchWeapons(ownEntries.flatMap((entry) => entry.weapons));

    return {
      activityId: pgcr.activityId,
      period: pgcr.period,
      activityName: pgcr.activityName,
      modeName: normalizeActivityModeName(pgcr.modeName, pgcr.mode),
      result,
      score: formatPvpScore(pgcr.teams, team),
      kills: own.kills,
      deaths: own.deaths,
      assists: own.assists,
      kd: own.kd,
      kda: own.kda,
      completed: ownEntries.some((entry) => entry.completed),
      teamKd: kdForPlayers(teamPlayers),
      opponentKd: kdForPlayers(opponentPlayers),
      weapons
    };
  }

  private async toWeaponUsage(weapon: Record<string, unknown>): Promise<WeaponUsageSummary> {
    const referenceId = String(weapon.referenceId ?? weapon.itemHash ?? "0");
    const name = await this.manifest.getDisplayName("DestinyInventoryItemDefinition", referenceId, `Weapon ${referenceId}`);
    const iconPath = await this.manifest.getIconPath("DestinyInventoryItemDefinition", referenceId);
    const values = asRecord(weapon.values);

    return {
      referenceId,
      name,
      iconPath: iconPath ?? undefined,
      kills: statBasicValue(values, "uniqueWeaponKills") || statBasicValue(values, "kills"),
      precisionKills: statBasicValue(values, "uniqueWeaponPrecisionKills") || statBasicValue(values, "precisionKills"),
      secondsUsed: statBasicValue(values, "secondsUsed") || statBasicValue(values, "activityDurationSeconds")
    };
  }

  private async getCraftablePresentationGroups(rootNodeHash: string | undefined): Promise<Map<string, string>> {
    const groups = new Map<string, string>();
    if (!rootNodeHash) {
      return groups;
    }
    try {
      const definitions = await this.manifest.getDefinitionMap<PresentationNodeDefinition>("DestinyPresentationNodeDefinition");
      const visit = (hashIdentifier: string, inheritedName: string | undefined, seen = new Set<string>()) => {
        if (seen.has(hashIdentifier)) {
          return;
        }
        seen.add(hashIdentifier);
        const definition = definitions[hashIdentifier];
        if (!definition) {
          return;
        }
        const name = optionalString(definition.displayProperties?.name) ?? inheritedName;
        for (const craftable of asArray(definition.children?.craftables)) {
          const craftableRecord = asRecord(craftable);
          const itemHash = optionalNumber(craftableRecord.craftableItemHash) ?? optionalString(craftableRecord.craftableItemHash);
          if (itemHash !== undefined && name) {
            groups.set(String(itemHash), name);
          }
        }
        for (const child of asArray(definition.children?.presentationNodes)) {
          const childRecord = asRecord(child);
          const childHash = optionalNumber(childRecord.presentationNodeHash) ?? optionalString(childRecord.presentationNodeHash);
          if (childHash !== undefined) {
            visit(String(childHash), name, new Set(seen));
          }
        }
      };
      visit(rootNodeHash, undefined);
    } catch {
      return groups;
    }
    return groups;
  }

  private async getPublicCraftableItemHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    try {
      const definitions = await this.manifest.getDefinitionMap<PresentationNodeDefinition>("DestinyPresentationNodeDefinition");
      for (const definition of Object.values(definitions)) {
        for (const craftable of asArray(definition.children?.craftables)) {
          const itemHash = optionalNumber(asRecord(craftable).craftableItemHash) ?? optionalString(asRecord(craftable).craftableItemHash);
          if (itemHash !== undefined) {
            hashes.add(String(itemHash));
          }
        }
      }
    } catch {
      return hashes;
    }
    return hashes;
  }

  private async toCraftableWeapon(
    itemHash: string,
    craftable: Record<string, unknown>,
    groupName: string | undefined
  ): Promise<CraftableWeaponSummary> {
    const definition = await this.manifest.getDefinition<InventoryItemDefinition>("DestinyInventoryItemDefinition", itemHash);
    const failedRequirementIndexes = asArray(craftable.failedRequirementIndexes)
      .map(Number)
      .filter((value) => Number.isInteger(value));
    const visible = asBoolean(craftable.visible, true);
    const socketCount = asArray(craftable.sockets).length;
    const requirementCount = failedRequirementIndexes.length;
    return {
      itemHash,
      name: asString(definition?.displayProperties?.name, `Weapon ${itemHash}`),
      iconPath: optionalString(definition?.displayProperties?.icon),
      itemTypeDisplayName: optionalString(definition?.itemTypeDisplayName),
      tierTypeName: optionalString(definition?.inventory?.tierTypeName),
      watermarkIconPath:
        optionalString(definition?.iconWatermark) ??
        optionalString(definition?.iconWatermarkShelved) ??
        optionalString(definition?.quality?.displayVersionWatermarkIcons?.[0]),
      groupName: groupName ?? "锻造武器",
      visible,
      unlocked: visible && failedRequirementIndexes.length === 0,
      failedRequirementIndexes,
      requirementCount,
      socketCount
    };
  }

  private async toItemInfoMatch(
    itemHash: string,
    definition: InventoryItemDefinition,
    match: { score: number; reason: string },
    inventoryDefinitions: Record<string, InventoryItemDefinition>,
    statDefinitions: Record<string, StatDefinition>,
    sandboxPerkDefinitions: Record<string, SandboxPerkDefinition>,
    craftableItems: Set<string>
  ): Promise<ItemInfoMatch> {
    const name = itemInfoName(definition, `Item ${itemHash}`);
    const catalyst = await this.itemInfoCatalystSummary(name);
    return {
      itemHash,
      name,
      description: optionalString(definition.displayProperties?.description),
      iconPath: optionalString(definition.displayProperties?.icon),
      watermarkIconPath:
        optionalString(definition.iconWatermark) ??
        optionalString(definition.iconWatermarkShelved) ??
        optionalString(definition.quality?.displayVersionWatermarkIcons?.[0]),
      itemTypeDisplayName: optionalString(definition.itemTypeDisplayName),
      tierTypeName: optionalString(definition.inventory?.tierTypeName),
      bucketName: optionalString(definition.inventory?.bucketTypeName),
      slotLabel: itemInfoSlotLabel(definition),
      damageType: itemInfoDamageType(definition),
      ammoType: itemInfoAmmoType(definition),
      className: itemInfoClassName(definition),
      source: itemInfoSource(definition),
      craftable: craftableItems.has(itemHash),
      stats: itemInfoStats(definition, statDefinitions),
      perks: itemInfoPerks(definition, inventoryDefinitions, sandboxPerkDefinitions),
      ...(catalyst ? { catalyst } : {}),
      match
    };
  }

  private async itemInfoCatalystSummary(weaponName: string): Promise<ItemInfoMatch["catalyst"] | undefined> {
    try {
      const info = await this.getCatalystInfo(weaponName);
      const match = info.matches.find((entry) => normalizeItemInfoMatchName(entry.weaponName) === normalizeItemInfoMatchName(weaponName)) ?? info.matches[0];
      if (!match) {
        return undefined;
      }
      return {
        recordHash: match.recordHash,
        catalystName: match.catalystName,
        effectDescription: match.effectDescription,
        completionDescription: match.completionDescription
      };
    } catch {
      return undefined;
    }
  }

  private async getCatalystPresentationRecordHashes(): Promise<Set<string>> {
    const result = new Set<string>();
    try {
      const definitions = await this.manifest.getDefinitionMap<PresentationNodeDefinition>("DestinyPresentationNodeDefinition");
      const catalystRoots = Object.entries(definitions)
        .filter(([, definition]) => isCatalystText(definition.displayProperties?.name, definition.displayProperties?.description))
        .map(([hash]) => hash);

      const visit = (hashIdentifier: string, seen = new Set<string>()) => {
        if (seen.has(hashIdentifier)) {
          return;
        }
        seen.add(hashIdentifier);
        const definition = definitions[hashIdentifier];
        if (!definition) {
          return;
        }
        for (const record of asArray(definition.children?.records)) {
          const recordHash = optionalNumber(asRecord(record).recordHash) ?? optionalString(asRecord(record).recordHash);
          if (recordHash !== undefined) {
            result.add(String(recordHash));
          }
        }
        for (const child of asArray(definition.children?.presentationNodes)) {
          const childHash = optionalNumber(asRecord(child).presentationNodeHash) ?? optionalString(asRecord(child).presentationNodeHash);
          if (childHash !== undefined) {
            visit(String(childHash), new Set(seen));
          }
        }
      };

      for (const root of catalystRoots) {
        visit(root);
      }
    } catch {
      return result;
    }
    return result;
  }

  private async getCatalystRecordCandidates(
    recordDefinitions: Record<string, RecordDefinition>,
    presentationRecordHashes: Set<string>
  ): Promise<string[]> {
    const candidates = new Set<string>(presentationRecordHashes);
    for (const [recordHash, definition] of Object.entries(recordDefinitions)) {
      if (
        presentationRecordHashes.has(recordHash) ||
        isCatalystText(definition.displayProperties?.name, definition.displayProperties?.description) ||
        isCatalystText(definition.loreHash, definition.recordTypeName)
      ) {
        candidates.add(recordHash);
      }
    }
    return [...candidates].sort((left, right) => {
      const leftName = catalystDisplayName(recordDefinitions[left]);
      const rightName = catalystDisplayName(recordDefinitions[right]);
      return leftName.localeCompare(rightName);
    });
  }

  private async safeInventoryDefinitions(): Promise<Record<string, InventoryItemDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<InventoryItemDefinition>("DestinyInventoryItemDefinition");
    } catch {
      return {};
    }
  }

  private async safeObjectiveDefinitions(): Promise<Record<string, ObjectiveDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<ObjectiveDefinition>("DestinyObjectiveDefinition");
    } catch {
      return {};
    }
  }

  private async safeSandboxPerkDefinitions(): Promise<Record<string, SandboxPerkDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<SandboxPerkDefinition>("DestinySandboxPerkDefinition");
    } catch {
      return {};
    }
  }

  private async safeInventoryBucketDefinitions(): Promise<Record<string, InventoryBucketDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<InventoryBucketDefinition>("DestinyInventoryBucketDefinition");
    } catch {
      return {};
    }
  }

  private async safeStatDefinitions(): Promise<Record<string, StatDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<StatDefinition>("DestinyStatDefinition");
    } catch {
      return {};
    }
  }

  private async safePlugSetDefinitions(): Promise<Record<string, PlugSetDefinition>> {
    try {
      return await this.manifest.getDefinitionMap<PlugSetDefinition>("DestinyPlugSetDefinition");
    } catch {
      return {};
    }
  }

  private async getPrivateProfile(
    membershipType: number,
    membershipId: string,
    accessToken: string,
    components: readonly (string | number)[]
  ): Promise<unknown> {
    return this.client.get<unknown>(`/Destiny2/${membershipType}/Profile/${membershipId}/`, {
      query: {
        components: [...components]
      },
      headers: oauthHeaders(accessToken)
    });
  }

  private async toInventorySummary(
    membershipType: number,
    membershipId: string,
    response: unknown,
    qq?: string
  ): Promise<InventorySummary> {
    const profileResponse = asRecord(response);
    const charactersData = asRecord(asRecord(profileResponse.characters).data);
    const characters = await Promise.all(
      Object.entries(charactersData).map(([characterId, value]) =>
        this.toCharacterSummary(characterId, asRecord(value))
      )
    );
    const [inventoryDefinitions, bucketDefinitions, statDefinitions] = await Promise.all([
      this.safeInventoryDefinitions(),
      this.safeInventoryBucketDefinitions(),
      this.safeStatDefinitions()
    ]);
    const itemComponents = asRecord(profileResponse.itemComponents);
    const itemInstances = asRecord(asRecord(asRecord(itemComponents.instances).data));
    const itemCommonData = asRecord(asRecord(asRecord(itemComponents.commonData).data));
    const itemSockets = asRecord(asRecord(asRecord(itemComponents.sockets).data));
    const itemReusablePlugs = asRecord(asRecord(asRecord(itemComponents.reusablePlugs).data));
    const itemStats = asRecord(asRecord(asRecord(itemComponents.stats).data));
    const items: InventoryItemSummary[] = [];

    this.addInventoryItems(
      items,
      asArray(asRecord(asRecord(profileResponse.profileInventory).data).items),
      "vault",
      undefined,
      inventoryDefinitions,
      bucketDefinitions,
      statDefinitions,
      itemInstances,
      itemCommonData,
      itemSockets,
      itemReusablePlugs,
      itemStats
    );

    const characterInventories = asRecord(asRecord(profileResponse.characterInventories).data);
    for (const [characterId, value] of Object.entries(characterInventories)) {
      this.addInventoryItems(
        items,
        asArray(asRecord(value).items),
        "inventory",
        characterId,
        inventoryDefinitions,
        bucketDefinitions,
        statDefinitions,
        itemInstances,
        itemCommonData,
        itemSockets,
        itemReusablePlugs,
        itemStats
      );
    }

    const characterEquipment = asRecord(asRecord(profileResponse.characterEquipment).data);
    for (const [characterId, value] of Object.entries(characterEquipment)) {
      this.addInventoryItems(
        items,
        asArray(asRecord(value).items),
        "equipped",
        characterId,
        inventoryDefinitions,
        bucketDefinitions,
        statDefinitions,
        itemInstances,
        itemCommonData,
        itemSockets,
        itemReusablePlugs,
        itemStats
      );
    }

    const totals = inventoryOwnerCounts(items);
    return {
      qq,
      membershipType,
      membershipId,
      characters,
      items: items.sort(compareInventoryItems),
      totals,
      updatedAt: new Date().toISOString()
    };
  }

  private addInventoryItems(
    target: InventoryItemSummary[],
    rawItems: unknown[],
    owner: InventoryOwner,
    characterId: string | undefined,
    inventoryDefinitions: Record<string, InventoryItemDefinition>,
    bucketDefinitions: Record<string, InventoryBucketDefinition>,
    statDefinitions: Record<string, StatDefinition>,
    itemInstances: Record<string, unknown>,
    itemCommonData: Record<string, unknown>,
    itemSockets: Record<string, unknown>,
    itemReusablePlugs: Record<string, unknown>,
    itemStats: Record<string, unknown>
  ): void {
    for (const rawItem of rawItems) {
      const item = this.toInventoryItemSummary(
        asRecord(rawItem),
        owner,
        characterId,
        inventoryDefinitions,
        bucketDefinitions,
        itemInstances,
        itemCommonData,
        itemSockets,
        itemReusablePlugs,
        itemStats,
        statDefinitions
      );
      if (item) {
        target.push(item);
      }
    }
  }

  private toInventoryItemSummary(
    item: Record<string, unknown>,
    owner: InventoryOwner,
    characterId: string | undefined,
    inventoryDefinitions: Record<string, InventoryItemDefinition>,
    bucketDefinitions: Record<string, InventoryBucketDefinition>,
    itemInstances: Record<string, unknown>,
    itemCommonData: Record<string, unknown>,
    itemSockets: Record<string, unknown>,
    itemReusablePlugs: Record<string, unknown>,
    itemStats: Record<string, unknown>,
    statDefinitions: Record<string, StatDefinition>
  ): InventoryItemSummary | null {
    const itemHash = optionalNumber(item.itemHash) ?? numberFrom(item.itemHash, Number.NaN);
    if (!Number.isFinite(itemHash)) {
      return null;
    }
    const instanceId = optionalString(item.itemInstanceId);
    const definition = inventoryDefinitions[String(itemHash)];
    const instance = asRecord(instanceId ? itemInstances[instanceId] : undefined);
    const common = asRecord(instanceId ? itemCommonData[instanceId] : undefined);
    const socketComponent = asRecord(instanceId ? itemSockets[instanceId] : undefined);
    const reusablePlugComponent = asRecord(instanceId ? itemReusablePlugs[instanceId] : undefined);
    const statComponent = asRecord(instanceId ? itemStats[instanceId] : undefined);
    const bucketHash =
      optionalNumber(item.bucketHash) ??
      optionalNumber(definition?.inventory?.bucketTypeHash) ??
      numberFrom(definition?.inventory?.bucketTypeHash, Number.NaN);
    const bucketDefinition = Number.isFinite(bucketHash) ? bucketDefinitions[String(bucketHash)] : undefined;
    const power = optionalNumber(asRecord(instance.primaryStat).value);
    const energy = asRecord(instance.energy);
    const state = optionalNumber(item.state);
    const locked = asBoolean(common.isLocked, isLockedInventoryItem(state));
    return {
      itemHash,
      ...(instanceId ? { itemInstanceId: instanceId } : {}),
      quantity: optionalNumber(item.quantity) ?? 1,
      owner,
      ...(characterId ? { characterId } : {}),
      ...(Number.isFinite(bucketHash) ? { bucketHash } : {}),
      bucketName:
        optionalString(bucketDefinition?.displayProperties?.name) ??
        optionalString(bucketDefinition?.displayProperties?.description) ??
        optionalString(definition?.inventory?.bucketTypeName),
      name: asString(definition?.displayProperties?.name, `Item ${itemHash}`),
      iconPath: optionalString(definition?.displayProperties?.icon),
      itemTypeDisplayName: optionalString(definition?.itemTypeDisplayName),
      tierTypeName: optionalString(definition?.inventory?.tierTypeName),
      ...(power !== undefined ? { power } : {}),
      locked,
      canEquip: asBoolean(instance.canEquip, Boolean(instanceId)),
      transferStatus: optionalNumber(instance.transferStatus),
      ...(state !== undefined ? { state } : {}),
      classType: optionalNumber(definition?.classType),
      damageType: optionalString(instance.damageType),
      energyCapacity: optionalNumber(energy.energyCapacity),
      energyUsed: optionalNumber(energy.energyUsed),
      ...inventorySocketsForItem(definition, socketComponent, reusablePlugComponent, inventoryDefinitions, statDefinitions),
      ...inventoryArmorStatsForItem(definition, statComponent, statDefinitions),
      ...inventoryWeaponStatsForItem(definition, statComponent, statDefinitions)
    };
  }

  private toCatalystInfoMatch(
    query: string,
    recordHash: string,
    definition: RecordDefinition,
    inventoryDefinitions: Record<string, InventoryItemDefinition>,
    objectiveDefinitions: Record<string, ObjectiveDefinition>,
    sandboxPerkDefinitions: Record<string, SandboxPerkDefinition>
  ): CatalystInfoMatch | null {
    const recordName = catalystDisplayName(definition, `Catalyst ${recordHash}`);
    const weaponHash = findCatalystWeaponHash(definition, recordName, inventoryDefinitions);
    const weaponDefinition = weaponHash ? inventoryDefinitions[weaponHash] : undefined;
    const catalystItemHash = findCatalystItemHash(definition, weaponHash, inventoryDefinitions);
    const catalystDefinition = catalystItemHash ? inventoryDefinitions[catalystItemHash] : undefined;
    const fallbackName = stripCatalystWords(recordName) || recordName;
    const recordDescription = optionalString(definition.displayProperties?.description);
    const catalystItemName = optionalString(catalystDefinition?.displayProperties?.name);
    const catalystItemDescription = optionalString(catalystDefinition?.displayProperties?.description);
    const aliasFallback = catalystAliasFallbackFor(
      recordName,
      fallbackName,
      optionalString(weaponDefinition?.displayProperties?.name),
      catalystItemName,
      catalystItemDescription
    );
    const weaponName = aliasFallback?.weaponName ?? asString(weaponDefinition?.displayProperties?.name, fallbackName);
    if (isLikelyCraftingPatternRecord(recordName, recordDescription, catalystItemName, catalystItemDescription)) {
      return null;
    }
    const score = catalystInfoMatchScore(query, {
      weaponName,
      recordName,
      recordDescription,
      catalystItemName,
      catalystItemDescription
    });
    if (!score) {
      return null;
    }
    const objectives = toCatalystInfoObjectives(definition, objectiveDefinitions);
    const definitionSlot = catalystSlotFromItem(weaponDefinition);
    const slot = definitionSlot === "unknown" && aliasFallback?.slot ? aliasFallback.slot : definitionSlot;
    const catalystDescription = recordDescription;
    const perkEffectDescription = catalystEffectDescriptionFromPerks(catalystDefinition, sandboxPerkDefinitions);
    const weaponDescription = optionalString(weaponDefinition?.displayProperties?.description);
    const effectDescription =
      firstMeaningfulCatalystText(
        perkEffectDescription,
        isGenericCatalystObjectiveText(catalystItemDescription) ? undefined : catalystItemDescription,
        isGenericCatalystObjectiveText(catalystDescription) ? undefined : catalystDescription,
        isGenericCatalystObjectiveText(weaponDescription) ? undefined : weaponDescription
      ) ?? undefined;
    const completionDescription = objectives.map((objective) => objective.description).filter(Boolean).join("；") || undefined;
    return {
      recordHash,
      weaponHash,
      catalystItemHash,
      weaponName,
      catalystName: recordName,
      catalystDescription,
      effectDescription,
      completionDescription,
      iconPath:
        optionalString(weaponDefinition?.displayProperties?.icon) ??
        optionalString(catalystDefinition?.displayProperties?.icon) ??
        optionalString(definition.displayProperties?.icon),
      itemTypeDisplayName: optionalString(weaponDefinition?.itemTypeDisplayName) ?? aliasFallback?.itemTypeDisplayName,
      slot,
      slotLabel: CATALYST_SLOT_LABELS[slot],
      objectives,
      match: score
    };
  }

  private toCatalystWeapon(
    recordHash: string,
    definition: RecordDefinition,
    component: Record<string, unknown> | undefined,
    inventoryDefinitions: Record<string, InventoryItemDefinition>
  ): CatalystWeaponSummary {
    const recordName = catalystDisplayName(definition, `Catalyst ${recordHash}`);
    const weaponHash = findCatalystWeaponHash(definition, recordName, inventoryDefinitions);
    const weaponDefinition = weaponHash ? inventoryDefinitions[weaponHash] : undefined;
    const componentRecord = asRecord(component);
    const objectives = toCatalystObjectives(component, definition);
    const progress = objectives.reduce((sum, objective) => sum + objective.progress, 0);
    const completionValue = objectives.reduce((sum, objective) => sum + objective.completionValue, 0);
    const redeemed = hasRecordState(componentRecord.state, 1);
    const visible = !hasRecordState(componentRecord.state, 8) && !hasRecordState(componentRecord.state, 16);
    const completed = redeemed || (objectives.length > 0 && objectives.every((objective) => objective.complete));
    const percent = completionValue > 0 ? round((Math.min(progress, completionValue) / completionValue) * 100) : completed ? 100 : 0;
    const obtained =
      visible &&
      (Boolean(component && Object.keys(componentRecord).length > 0) || redeemed || completed || progress > 0);
    const slot = catalystSlotFromItem(weaponDefinition);
    const fallbackName = stripCatalystWords(recordName) || recordName;
    const aliasFallback = catalystAliasFallbackFor(recordName, fallbackName, optionalString(weaponDefinition?.displayProperties?.name));
    const resolvedSlot = slot === "unknown" && aliasFallback?.slot ? aliasFallback.slot : slot;
    return {
      recordHash,
      weaponHash,
      name: aliasFallback?.weaponName ?? asString(weaponDefinition?.displayProperties?.name, fallbackName),
      description: optionalString(definition.displayProperties?.description),
      iconPath: optionalString(weaponDefinition?.displayProperties?.icon) ?? optionalString(definition.displayProperties?.icon),
      itemTypeDisplayName: optionalString(weaponDefinition?.itemTypeDisplayName) ?? aliasFallback?.itemTypeDisplayName,
      slot: resolvedSlot,
      slotLabel: CATALYST_SLOT_LABELS[resolvedSlot],
      completed,
      obtained,
      redeemed,
      visible,
      percent,
      progress,
      completionValue,
      objectives
    };
  }

  private async resolveModeName(mode: unknown): Promise<string | undefined> {
    const modeNumber = asNumber(mode, NaN);
    if (!Number.isFinite(modeNumber)) {
      return undefined;
    }
    const fallback = `Mode ${modeNumber}`;
    const displayName = await this.manifest.getDisplayName("DestinyActivityModeDefinition", modeNumber, fallback);
    return displayName === fallback ? fallbackActivityModeName(modeNumber) ?? fallback : displayName;
  }

  private fallbackClassName(classType: number): string {
    switch (classType) {
      case 0:
        return "泰坦";
      case 1:
        return "猎人";
      case 2:
        return "术士";
      default:
        return "未知职业";
    }
  }

  private addAggregateRaidActivity(
    groups: Map<string, RaidOverviewGroup>,
    activity: Record<string, unknown>,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): void {
    const activityHash = optionalNumber(activity.activityHash) ?? optionalString(activity.activityHash);
    const definition = activityHash === undefined || activityHash === null ? undefined : activityDefinitions[String(activityHash)];
    if (!definition || !isRaidActivityDefinition(definition)) {
      return;
    }

    const parsed = parseRaidActivityDisplayName(asString(definition.displayProperties?.name, `Raid ${activityHash}`));
    if (isPantheonActivityName(parsed.name)) {
      return;
    }
    const group = getOrCreateRaidGroup(groups, parsed, definition);
    const hashNumber = Number(activityHash);
    if (Number.isFinite(hashNumber)) {
      group.activityHashes.add(hashNumber);
    }

    const values = asRecord(activity.values);
    group.completions += statBasicValue(values, "activityCompletions");
    group.fullClears += statBasicValue(values, "activityWins");
    group.wins = group.fullClears;
    group.kills += statBasicValue(values, "activityKills");
    group.deaths += statBasicValue(values, "activityDeaths");
    group.secondsPlayed += statBasicValue(values, "activitySecondsPlayed");

    const fastest = statBasicValue(values, "fastestCompletionMsForActivity");
    if (fastest > 0 && (group.fastestCompletionMs === undefined || fastest < group.fastestCompletionMs)) {
      group.fastestCompletionMs = fastest;
      group.fastestCompletionDisplay = statDisplayValue(values, "fastestCompletionMsForActivity");
      group.fastestActivityId = statActivityId(values, "fastestCompletionMsForActivity");
    }
  }

  private addAggregateDungeonActivity(
    groups: Map<string, DungeonOverviewGroup>,
    activity: Record<string, unknown>,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): void {
    const activityHash = optionalNumber(activity.activityHash) ?? optionalString(activity.activityHash);
    const definition = activityHash === undefined || activityHash === null ? undefined : activityDefinitions[String(activityHash)];
    if (!definition || !isDungeonActivityDefinition(definition)) {
      return;
    }

    const parsed = parseRaidActivityDisplayName(asString(definition.displayProperties?.name, `Dungeon ${activityHash}`));
    const group = getOrCreateDungeonGroup(groups, parsed, definition);
    const hashNumber = Number(activityHash);
    if (Number.isFinite(hashNumber)) {
      group.activityHashes.add(hashNumber);
    }

    const values = asRecord(activity.values);
    group.completions += statBasicValue(values, "activityCompletions");
    group.fullClears += statBasicValue(values, "activityWins");
    group.wins = group.fullClears;
    group.kills += statBasicValue(values, "activityKills");
    group.deaths += statBasicValue(values, "activityDeaths");
    group.secondsPlayed += statBasicValue(values, "activitySecondsPlayed");

    const fastest = statBasicValue(values, "fastestCompletionMsForActivity");
    if (fastest > 0 && (group.fastestCompletionMs === undefined || fastest < group.fastestCompletionMs)) {
      group.fastestCompletionMs = fastest;
      group.fastestCompletionDisplay = statDisplayValue(values, "fastestCompletionMsForActivity");
      group.fastestActivityId = statActivityId(values, "fastestCompletionMsForActivity");
    }
  }

  private addAggregateModeActivity(
    groups: Map<string, ActivityOverviewGroup>,
    activity: Record<string, unknown>,
    activityDefinitions: Record<string, RaidActivityDefinition>,
    modeType: number
  ): void {
    const activityHash = optionalNumber(activity.activityHash) ?? optionalString(activity.activityHash);
    const definition = activityHash === undefined || activityHash === null ? undefined : activityDefinitions[String(activityHash)];
    if (!definition || !isActivityDefinitionForMode(definition, modeType)) {
      return;
    }

    const name = normalizeActivityDisplayName(asString(definition.displayProperties?.name, `Activity ${activityHash}`));
    const group = getOrCreateActivityGroup(groups, name, definition);
    const hashNumber = Number(activityHash);
    if (Number.isFinite(hashNumber)) {
      group.activityHashes.add(hashNumber);
    }

    const values = asRecord(activity.values);
    group.completions += statBasicValue(values, "activityCompletions");
    group.wins += statBasicValue(values, "activityWins");
    group.kills += statBasicValue(values, "activityKills");
    group.deaths += statBasicValue(values, "activityDeaths");
    group.secondsPlayed += statBasicValue(values, "activitySecondsPlayed");

    const fastest = statBasicValue(values, "fastestCompletionMsForActivity");
    if (fastest > 0 && (group.fastestCompletionMs === undefined || fastest < group.fastestCompletionMs)) {
      group.fastestCompletionMs = fastest;
      group.fastestCompletionDisplay = statDisplayValue(values, "fastestCompletionMsForActivity");
      group.fastestActivityId = statActivityId(values, "fastestCompletionMsForActivity");
    }
  }

  private async getRecentRaidActivitiesForScan(
    membershipType: number,
    membershipId: string,
    characterIds: string[],
    historyPages: number,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): Promise<ActivitySummary[]> {
    const raidMode = parsePublicMode("raid");
    const perCharacter = await Promise.all(
      characterIds.map(async (characterId) => {
        const pages = await Promise.allSettled(
          Array.from({ length: historyPages }, (_, page) =>
            this.getCharacterActivitiesForRaidScan(
              membershipType,
              membershipId,
              characterId,
              raidMode,
              RAID_HISTORY_PAGE_SIZE,
              page,
              activityDefinitions
            )
          )
        );
        return pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
      })
    );

    const candidates = perCharacter
      .flat()
      .filter(uniqueActivity())
      .sort((a, b) => b.period.localeCompare(a.period));
    return candidates.filter((activity) => {
      const definition = activity.referenceId === undefined ? undefined : activityDefinitions[String(activity.referenceId)];
      const parsed = parseRaidActivityDisplayName(asString(definition?.displayProperties?.name, activity.activityName));
      return definition && isRaidActivityDefinition(definition) && !isPantheonActivityName(parsed.name);
    });
  }

  private async getRecentModeActivitiesForScan(
    membershipType: number,
    membershipId: string,
    characterIds: string[],
    mode: ModeInfo,
    historyPages: number,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): Promise<ActivitySummary[]> {
    if (mode.bungieMode === undefined) {
      return [];
    }

    const perCharacter = await Promise.all(
      characterIds.map(async (characterId) => {
        const pages = await Promise.all(
          Array.from({ length: historyPages }, (_, page) =>
            this.getCharacterActivities(membershipType, membershipId, characterId, mode, RAID_HISTORY_PAGE_SIZE, page)
          )
        );
        return pages.flat();
      })
    );

    return perCharacter
      .flat()
      .filter(uniqueActivity())
      .sort((a, b) => b.period.localeCompare(a.period))
      .filter((activity) => {
        const definition = activity.referenceId === undefined ? undefined : activityDefinitions[String(activity.referenceId)];
        return definition !== undefined && isActivityDefinitionForMode(definition, mode.bungieMode!);
      });
  }

  private async getRecentGrandmasterActivitiesForScan(
    membershipType: number,
    membershipId: string,
    characterIds: string[],
    historyPages: number,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): Promise<ActivitySummary[]> {
    const perCharacter = await Promise.all(
      characterIds.map(async (characterId) => {
        const pages = await Promise.all(
          Array.from({ length: historyPages }, (_, page) =>
            this.getCharacterActivitiesForGrandmasterScan(
              membershipType,
              membershipId,
              characterId,
              RAID_HISTORY_PAGE_SIZE,
              page,
              activityDefinitions
            )
          )
        );
        return pages.flat();
      })
    );

    return perCharacter
      .flat()
      .filter(uniqueActivity())
      .sort((a, b) => b.period.localeCompare(a.period))
      .filter((activity) => {
        const definition = activity.referenceId === undefined ? undefined : activityDefinitions[String(activity.referenceId)];
        return definition !== undefined && isGrandmasterActivityDefinition(definition);
      });
  }

  private async getCharacterActivitiesForRaidScan(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: ModeInfo,
    count: number,
    page: number,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): Promise<ActivitySummary[]> {
    const response = await this.client.get<unknown>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/`,
      {
        query: {
          count,
          page,
          ...(mode.bungieMode === undefined ? {} : { mode: mode.bungieMode })
        }
      }
    );

    return asArray(asRecord(response).activities).map((activity) => {
      const record = asRecord(activity);
      const activityDetails = asRecord(record.activityDetails);
      const referenceId = optionalNumber(activityDetails.referenceId);
      const modeNumber = optionalNumber(activityDetails.mode);
      const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];

      return {
        period: asString(record.period),
        activityId: asString(activityDetails.instanceId),
        referenceId,
        activityName: asString(definition?.displayProperties?.name, `Activity ${referenceId}`),
        mode: modeNumber,
        characterId,
        values: asRecord(record.values)
      };
    });
  }

  private async getCharacterActivitiesForGrandmasterScan(
    membershipType: number,
    membershipId: string,
    characterId: string,
    count: number,
    page: number,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): Promise<ActivitySummary[]> {
    const response = await this.client.get<unknown>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/`,
      {
        query: {
          count,
          page,
          mode: GRANDMASTER_NIGHTFALL_MODE_TYPE
        }
      }
    );

    return asArray(asRecord(response).activities).map((activity) => {
      const record = asRecord(activity);
      const activityDetails = asRecord(record.activityDetails);
      const referenceId = optionalNumber(activityDetails.referenceId);
      const modeNumber = optionalNumber(activityDetails.mode);
      const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];

      return {
        period: asString(record.period),
        activityId: asString(activityDetails.instanceId),
        referenceId,
        activityName: grandmasterDisplayName(definition, `Activity ${referenceId}`),
        mode: modeNumber,
        characterId,
        values: asRecord(record.values)
      };
    });
  }

  private groupForActivity(
    groups: Map<string, RaidOverviewGroup>,
    referenceId: number | undefined,
    fallbackName: string,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): RaidOverviewGroup | null {
    const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];
    const parsed = parseRaidActivityDisplayName(asString(definition?.displayProperties?.name, fallbackName));
    if (isPantheonActivityName(parsed.name)) {
      return null;
    }
    return groups.get(parsed.key) ??
      (definition && isRaidActivityDefinition(definition) ? getOrCreateRaidGroup(groups, parsed, definition) : null);
  }

  private groupForDungeonActivity(
    groups: Map<string, DungeonOverviewGroup>,
    referenceId: number | undefined,
    fallbackName: string,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): DungeonOverviewGroup | null {
    const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];
    const parsed = parseRaidActivityDisplayName(asString(definition?.displayProperties?.name, fallbackName));
    return groups.get(parsed.key) ??
      (definition && isDungeonActivityDefinition(definition) ? getOrCreateDungeonGroup(groups, parsed, definition) : null);
  }

  private groupForModeActivity(
    groups: Map<string, ActivityOverviewGroup>,
    referenceId: number | undefined,
    fallbackName: string,
    activityDefinitions: Record<string, RaidActivityDefinition>,
    modeType: number
  ): ActivityOverviewGroup | null {
    const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];
    const name = normalizeActivityDisplayName(asString(definition?.displayProperties?.name, fallbackName));
    return groups.get(name) ??
      (definition && isActivityDefinitionForMode(definition, modeType)
        ? getOrCreateActivityGroup(groups, name, definition)
        : null);
  }

  private groupForGrandmasterActivity(
    groups: Map<string, GrandmasterOverviewGroup>,
    referenceId: number | undefined,
    fallbackName: string,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): GrandmasterOverviewGroup | null {
    const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];
    const name = grandmasterDisplayName(definition, fallbackName);
    return groups.get(name) ??
      (definition && isGrandmasterActivityDefinition(definition)
        ? getOrCreateGrandmasterGroup(groups, name, definition)
        : null);
  }

  private applyRaidPgcrScan(group: RaidOverviewGroup, pgcr: PgcrSummary, membershipId: string): void {
    const playerEntries = pgcr.players.filter((player) => player.membershipId === membershipId);
    const playerCompleted = playerEntries.some((player) => player.completed);
    if (!playerCompleted) {
      return;
    }

    group.scannedCompletions += 1;
    const completedPlayers = pgcr.players.filter((player) => player.completed);
    const fireteamSize = completedPlayers.length || pgcr.players.length;
    if (fireteamSize === 1) {
      group.fireteamSizes.solo += 1;
      group.tags.add("Solo");
    } else if (fireteamSize === 2) {
      group.fireteamSizes.duo += 1;
      group.tags.add("Duo");
    } else if (fireteamSize === 3) {
      group.fireteamSizes.trio += 1;
      group.tags.add("Trio");
    }
    const personalFlawless = playerEntries.some((player) => player.completed && player.deaths === 0);
    const fireteamFlawless = pgcr.players.length > 0 && pgcr.players.every((player) => player.deaths === 0);
    if (personalFlawless) {
      group.flawless = {
        status: "confirmed",
        personal: true,
        fireteam: fireteamFlawless,
        activityId: pgcr.activityId,
        period: pgcr.period
      };
    }

    if (pgcr.period && group.dayOne.releaseAt && isInsideReleaseWindow(pgcr.period, group.dayOne.releaseAt, group.dayOne.windowHours)) {
      group.dayOne = {
        ...group.dayOne,
        status: "confirmed",
        activityId: pgcr.activityId,
        period: pgcr.period
      };
    }
  }

  private applyDungeonPgcrScan(group: DungeonOverviewGroup, pgcr: PgcrSummary, membershipId: string): void {
    const playerEntries = pgcr.players.filter((player) => player.membershipId === membershipId);
    const playerCompleted = playerEntries.some((player) => player.completed);
    if (!playerCompleted) {
      return;
    }

    group.scannedCompletions += 1;
    const completedPlayers = pgcr.players.filter((player) => player.completed);
    const fireteamSize = completedPlayers.length || pgcr.players.length;
    if (fireteamSize === 1) {
      group.fireteamSizes.solo += 1;
      group.tags.add("Solo");
    } else if (fireteamSize === 2) {
      group.fireteamSizes.duo += 1;
      group.tags.add("Duo");
    } else if (fireteamSize === 3) {
      group.fireteamSizes.trio += 1;
      group.tags.add("Trio");
    }

    const personalFlawless = playerEntries.some((player) => player.completed && player.deaths === 0);
    const fireteamFlawless = completedPlayers.length > 0 && completedPlayers.every((player) => player.deaths === 0);
    if (personalFlawless) {
      group.flawless = {
        status: "confirmed",
        personal: true,
        fireteam: fireteamFlawless,
        activityId: pgcr.activityId,
        period: pgcr.period
      };
      if (fireteamSize === 1) {
        group.tags.add("Flawless Solo");
      }
    }
  }

  private addAggregateGrandmasterActivity(
    groups: Map<string, GrandmasterOverviewGroup>,
    activity: Record<string, unknown>,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): void {
    const activityHash = optionalNumber(activity.activityHash) ?? optionalString(activity.activityHash);
    const definition = activityHash === undefined || activityHash === null ? undefined : activityDefinitions[String(activityHash)];
    if (!definition || !isGrandmasterActivityDefinition(definition)) {
      return;
    }

    const group = getOrCreateGrandmasterGroup(groups, grandmasterDisplayName(definition, `Activity ${activityHash}`), definition);
    const hashNumber = Number(activityHash);
    if (Number.isFinite(hashNumber)) {
      group.activityHashes.add(hashNumber);
    }

    const values = asRecord(activity.values);
    group.completions += statBasicValue(values, "activityCompletions");
    group.lifetimeClears += statBasicValue(values, "activityWins");
    group.kills += statBasicValue(values, "activityKills");
    group.deaths += statBasicValue(values, "activityDeaths");
    group.secondsPlayed += statBasicValue(values, "activitySecondsPlayed");

    const fastest = statBasicValue(values, "fastestCompletionMsForActivity");
    if (fastest > 0 && (group.fastestCompletionMs === undefined || fastest < group.fastestCompletionMs)) {
      group.fastestCompletionMs = fastest;
      group.fastestCompletionDisplay = statDisplayValue(values, "fastestCompletionMsForActivity");
      group.fastestActivityId = statActivityId(values, "fastestCompletionMsForActivity");
    }
  }

  private applyGrandmasterPgcrScan(group: GrandmasterOverviewGroup, activity: ActivitySummary, pgcr: PgcrSummary, membershipId: string): void {
    const playerEntries = pgcr.players.filter((player) => player.membershipId === membershipId);
    const playerCompleted = playerEntries.some((player) => player.completed) || statBasicValue(activity.values, "completed") > 0;
    if (!playerCompleted) {
      return;
    }

    const durationSeconds = statBasicValue(activity.values, "activityDurationSeconds");
    if (durationSeconds > 0) {
      const durationMs = durationSeconds * 1000;
      if (group.fastestCompletionMs === undefined || durationMs < group.fastestCompletionMs) {
        group.fastestCompletionMs = durationMs;
        group.fastestCompletionDisplay = formatDurationSeconds(durationSeconds);
        group.fastestActivityId = activity.activityId;
      }
    }
    if (!group.lastClearedAt || activity.period > group.lastClearedAt) {
      group.lastClearedAt = activity.period;
      group.lastActivityId = activity.activityId;
    }
  }

  private toGrandmasterRecentActivity(
    activity: ActivitySummary,
    pgcr: PgcrSummary,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): GrandmasterRecentActivity {
    const definition = activity.referenceId === undefined ? undefined : activityDefinitions[String(activity.referenceId)];
    const playerRows = pgcr.players.slice().sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0));
    const completed = statBasicValue(activity.values, "completed") > 0 || pgcr.players.some((player) => player.completed);
    const durationSeconds = statBasicValue(activity.values, "activityDurationSeconds");
    return {
      activityId: activity.activityId,
      referenceId: activity.referenceId,
      activityName: grandmasterDisplayName(definition, activity.activityName || pgcr.activityName),
      pgcrImage: definition?.pgcrImage,
      period: pgcr.period ?? activity.period,
      completed,
      durationSeconds,
      kills: playerRows.reduce((sum, player) => sum + player.kills, 0),
      deaths: playerRows.reduce((sum, player) => sum + player.deaths, 0),
      assists: playerRows.reduce((sum, player) => sum + player.assists, 0),
      players: playerRows.map(toGrandmasterRecentPlayer)
    };
  }

  private async getActiveSeasonWindow(): Promise<SeasonWindow | undefined> {
    const seasons = await this.getCareerSeasons();
    const active = seasons?.find((season) => season.active && season.startDate && season.endDate);
    if (!active?.startDate || !active.endDate) {
      return undefined;
    }
    return {
      name: active.name,
      startDate: active.startDate,
      endDate: active.endDate
    };
  }
}

interface RaidActivityDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
  };
  selectionScreenDisplayProperties?: {
    name?: string;
    description?: string;
  };
  activityModeTypes?: number[];
  activityModeHashes?: number[];
  directActivityModeType?: number;
  directActivityModeHash?: number;
  recommendedLight?: number;
  pgcrImage?: string;
  [key: string]: unknown;
}

interface RaidOverviewGroup {
  key: string;
  name: string;
  displayName: string;
  difficulty: string;
  difficultyLabel: string;
  activityHashes: Set<number>;
  pgcrImage?: string;
  fullClears: number;
  completions: number;
  wins: number;
  kills: number;
  deaths: number;
  secondsPlayed: number;
  fastestCompletionMs?: number;
  fastestCompletionDisplay?: string;
  fastestActivityId?: string;
  lastClearedAt?: string;
  lastActivityId?: string;
  scannedCompletions: number;
  sherpaCompletions: number;
  fireteamSizes: {
    solo: number;
    duo: number;
    trio: number;
  };
  tags: Set<string>;
  flawless: RaidOverviewActivity["flawless"];
  dayOne: RaidOverviewActivity["dayOne"];
  releaseAt?: string;
  sortOrder: number;
}

interface DungeonOverviewGroup {
  key: string;
  name: string;
  displayName: string;
  difficulty: string;
  difficultyLabel: string;
  activityHashes: Set<number>;
  pgcrImage?: string;
  fullClears: number;
  completions: number;
  wins: number;
  kills: number;
  deaths: number;
  secondsPlayed: number;
  fastestCompletionMs?: number;
  fastestCompletionDisplay?: string;
  fastestActivityId?: string;
  lastClearedAt?: string;
  lastActivityId?: string;
  scannedCompletions: number;
  sherpaCompletions: number;
  fireteamSizes: {
    solo: number;
    duo: number;
    trio: number;
  };
  tags: Set<string>;
  flawless: DungeonOverviewActivity["flawless"];
  sortOrder: number;
}

interface ActivityOverviewGroup {
  name: string;
  activityHashes: Set<number>;
  pgcrImage?: string;
  completions: number;
  wins: number;
  kills: number;
  deaths: number;
  secondsPlayed: number;
  fastestCompletionMs?: number;
  fastestCompletionDisplay?: string;
  fastestActivityId?: string;
  lastClearedAt?: string;
  lastActivityId?: string;
}

interface GrandmasterOverviewGroup {
  name: string;
  activityHashes: Set<number>;
  pgcrImage?: string;
  currentSeasonClears: number;
  lifetimeClears: number;
  attempts: number;
  completions: number;
  kills: number;
  deaths: number;
  secondsPlayed: number;
  fastestCompletionMs?: number;
  fastestCompletionDisplay?: string;
  fastestActivityId?: string;
  lastClearedAt?: string;
  lastActivityId?: string;
}

interface ParsedRaidActivityName {
  key: string;
  name: string;
  difficulty: string;
  difficultyLabel: string;
}

function isRaidActivityDefinition(definition: RaidActivityDefinition): boolean {
  return Array.isArray(definition.activityModeTypes) && definition.activityModeTypes.includes(RAID_MODE_TYPE);
}

function isDungeonActivityDefinition(definition: RaidActivityDefinition): boolean {
  return Array.isArray(definition.activityModeTypes) && definition.activityModeTypes.includes(DUNGEON_MODE_TYPE);
}

function isActivityDefinitionForMode(definition: RaidActivityDefinition, modeType: number): boolean {
  return Array.isArray(definition.activityModeTypes) && definition.activityModeTypes.includes(modeType);
}

function isGrandmasterActivityDefinition(definition: RaidActivityDefinition): boolean {
  const text = [
    definition.displayProperties?.name,
    definition.displayProperties?.description,
    definition.selectionScreenDisplayProperties?.name,
    definition.selectionScreenDisplayProperties?.description
  ].join(" ");
  return /宗师|grandmaster/iu.test(text);
}

function getOrCreateRaidGroup(
  groups: Map<string, RaidOverviewGroup>,
  parsed: ParsedRaidActivityName,
  definition: RaidActivityDefinition
): RaidOverviewGroup {
  const existing = groups.get(parsed.key);
  if (existing) {
    existing.pgcrImage ??= definition.pgcrImage;
    return existing;
  }

  const releaseWindow = findRaidReleaseWindow(parsed.name);
  const group: RaidOverviewGroup = {
    key: parsed.key,
    name: parsed.name,
    displayName: `${parsed.name}：${parsed.difficultyLabel}`,
    difficulty: parsed.difficulty,
    difficultyLabel: parsed.difficultyLabel,
    activityHashes: new Set(),
    pgcrImage: definition.pgcrImage,
    fullClears: 0,
    completions: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0,
    scannedCompletions: 0,
    sherpaCompletions: 0,
    fireteamSizes: {
      solo: 0,
      duo: 0,
      trio: 0
    },
    tags: new Set(),
    flawless: {
      status: "unknown",
      personal: false,
      fireteam: false
    },
    dayOne: {
      status: "unknown",
      releaseAt: releaseWindow?.releaseAt,
      windowHours: releaseWindow?.windowHours
    },
    releaseAt: releaseWindow?.releaseAt,
    sortOrder: releaseWindow ? new Date(releaseWindow.releaseAt).getTime() : 0
  };
  groups.set(parsed.key, group);
  return group;
}

function getOrCreateDungeonGroup(
  groups: Map<string, DungeonOverviewGroup>,
  parsed: ParsedRaidActivityName,
  definition: RaidActivityDefinition
): DungeonOverviewGroup {
  const existing = groups.get(parsed.key);
  if (existing) {
    existing.pgcrImage ??= definition.pgcrImage;
    return existing;
  }

  const group: DungeonOverviewGroup = {
    key: parsed.key,
    name: parsed.name,
    displayName: `${parsed.name}：${parsed.difficultyLabel}`,
    difficulty: parsed.difficulty,
    difficultyLabel: parsed.difficultyLabel,
    activityHashes: new Set(),
    pgcrImage: definition.pgcrImage,
    fullClears: 0,
    completions: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0,
    scannedCompletions: 0,
    sherpaCompletions: 0,
    fireteamSizes: {
      solo: 0,
      duo: 0,
      trio: 0
    },
    tags: new Set(),
    flawless: {
      status: "unknown",
      personal: false,
      fireteam: false
    },
    sortOrder: 0
  };
  groups.set(parsed.key, group);
  return group;
}

function getOrCreateActivityGroup(
  groups: Map<string, ActivityOverviewGroup>,
  name: string,
  definition: RaidActivityDefinition
): ActivityOverviewGroup {
  const existing = groups.get(name);
  if (existing) {
    existing.pgcrImage ??= definition.pgcrImage;
    return existing;
  }

  const group: ActivityOverviewGroup = {
    name,
    activityHashes: new Set(),
    pgcrImage: definition.pgcrImage,
    completions: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0
  };
  groups.set(name, group);
  return group;
}

function getOrCreateGrandmasterGroup(
  groups: Map<string, GrandmasterOverviewGroup>,
  name: string,
  definition: RaidActivityDefinition
): GrandmasterOverviewGroup {
  const existing = groups.get(name);
  if (existing) {
    existing.pgcrImage ??= definition.pgcrImage;
    return existing;
  }

  const group: GrandmasterOverviewGroup = {
    name,
    activityHashes: new Set(),
    pgcrImage: definition.pgcrImage,
    currentSeasonClears: 0,
    lifetimeClears: 0,
    attempts: 0,
    completions: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0
  };
  groups.set(name, group);
  return group;
}

function normalizeRaidDisplayName(name: string): string {
  return name
    .replace(/\s*[:：]\s*(Normal|Master|Legend|Contest|Epic|Standard|标准|大师|普通|传说|竞赛|史诗)\s*$/iu, "")
    .replace(/\s*[（(]\s*(Normal|Master|Legend|Contest|Epic|Standard|标准|大师|普通|传说|竞赛|史诗)\s*[）)]\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseRaidActivityDisplayName(rawName: string): ParsedRaidActivityName {
  const cleaned = rawName.replace(/\s+/gu, " ").trim();
  const suffix = /^(.*?)(?:\s*[:：]\s*|\s*[（(]\s*)(Normal|Master|Legend|Contest|Epic|Standard|标准|大师|普通|传说|竞赛|史诗)\s*[）)]?\s*$/iu.exec(cleaned);
  const baseName = normalizeRaidDisplayName(suffix?.[1] ? suffix[1] : cleaned);
  const difficulty = normalizeDifficulty(suffix?.[2]);
  const difficultyLabel = difficultyLabelFor(difficulty);
  return {
    key: `${normalizeRaidNameForKey(baseName)}:${difficulty}`,
    name: baseName,
    difficulty,
    difficultyLabel
  };
}

function normalizeDifficulty(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || ["normal", "standard", "普通", "标准"].includes(normalized)) {
    return "normal";
  }
  if (["master", "大师"].includes(normalized)) {
    return "master";
  }
  if (["legend", "传说"].includes(normalized)) {
    return "legend";
  }
  if (["contest", "竞赛"].includes(normalized)) {
    return "contest";
  }
  if (["epic", "史诗"].includes(normalized)) {
    return "epic";
  }
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "-") || "normal";
}

function difficultyLabelFor(value: string): string {
  switch (value) {
    case "master":
      return "大师";
    case "legend":
      return "传说";
    case "contest":
      return "竞赛";
    case "epic":
      return "史诗";
    default:
      return "普通";
  }
}

function difficultySort(value: string): number {
  switch (value) {
    case "normal":
      return 0;
    case "master":
      return 1;
    case "legend":
      return 2;
    case "contest":
      return 3;
    default:
      return 9;
  }
}

function normalizeRaidNameForKey(value: string): string {
  return value.toLowerCase().replaceAll("’", "'").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeActivityDisplayName(name: string): string {
  return normalizeRaidDisplayName(name);
}

function grandmasterDisplayName(definition: RaidActivityDefinition | undefined, fallback: string): string {
  const rawName =
    optionalString(definition?.displayProperties?.name) ??
    optionalString(definition?.selectionScreenDisplayProperties?.name) ??
    fallback;
  const cleaned = rawName
    .replace(/\s*[:：]\s*(Grandmaster|宗师)\s*$/iu, "")
    .replace(/\s*[（(]\s*(Grandmaster|宗师)\s*[）)]\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (isGenericGrandmasterDisplayName(cleaned)) {
    const specificName = [
      definition?.displayProperties?.description,
      optionalString(asRecord(definition?.originalDisplayProperties).description),
      fallback
    ]
      .map((value) => optionalString(value))
      .find((value) => value && !isGenericGrandmasterDisplayName(value));
    if (specificName) {
      return `宗师日落: ${specificName.replace(/\s+/gu, " ").trim()}`;
    }
  }
  return cleaned;
}

function isGenericGrandmasterDisplayName(value: string | undefined): boolean {
  const normalized = String(value || "")
    .replace(/\s*[:：]\s*(Grandmaster|宗师)\s*$/iu, "")
    .replace(/\s*[（(]\s*(Grandmaster|宗师)\s*[）)]\s*$/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
  return normalized === "nightfall" || normalized === "grandmaster" || normalized === "日落" || normalized === "宗师";
}

function isPantheonActivityName(name: string): boolean {
  return /pantheon|众神殿/iu.test(name);
}

function statDisplayValue(values: unknown, key: string): string | undefined {
  const stat = asRecord(asRecord(values)[key]);
  const basic = asRecord(stat.basic);
  return optionalString(basic.displayValue);
}

function statActivityId(values: unknown, key: string): string | undefined {
  const stat = asRecord(asRecord(values)[key]);
  return optionalString(stat.activityId);
}

function isInsideReleaseWindow(period: string, releaseAt: string, windowHours: number | undefined): boolean {
  const periodMs = new Date(period).getTime();
  const releaseMs = new Date(releaseAt).getTime();
  const hours = windowHours ?? 24;
  return Number.isFinite(periodMs) && periodMs >= releaseMs && periodMs <= releaseMs + hours * 60 * 60 * 1000;
}

function finalizeRaidGroup(group: RaidOverviewGroup): RaidOverviewActivity {
  return {
    name: group.name,
    displayName: group.displayName,
    difficulty: group.difficulty,
    difficultyLabel: group.difficultyLabel,
    activityHashes: [...group.activityHashes].sort((a, b) => a - b),
    pgcrImage: group.pgcrImage,
    clears: group.fullClears,
    fullClears: group.fullClears,
    completions: group.completions,
    wins: group.wins,
    kills: group.kills,
    deaths: group.deaths,
    secondsPlayed: group.secondsPlayed,
    fastestCompletionMs: group.fastestCompletionMs,
    fastestCompletionDisplay: group.fastestCompletionDisplay,
    fastestActivityId: group.fastestActivityId,
    lastClearedAt: group.lastClearedAt,
    lastActivityId: group.lastActivityId,
    scannedCompletions: group.scannedCompletions,
    sherpaCompletions: group.sherpaCompletions,
    fireteamSizes: group.fireteamSizes,
    tags: [...group.tags],
    flawless: group.flawless,
    dayOne: group.dayOne,
    releaseAt: group.releaseAt,
    sortOrder: group.sortOrder
  };
}

function finalizeDungeonGroup(group: DungeonOverviewGroup): DungeonOverviewActivity {
  return {
    name: group.name,
    displayName: group.displayName,
    difficulty: group.difficulty,
    difficultyLabel: group.difficultyLabel,
    activityHashes: [...group.activityHashes].sort((a, b) => a - b),
    pgcrImage: group.pgcrImage,
    clears: group.fullClears,
    fullClears: group.fullClears,
    completions: group.completions,
    wins: group.wins,
    kills: group.kills,
    deaths: group.deaths,
    secondsPlayed: group.secondsPlayed,
    fastestCompletionMs: group.fastestCompletionMs,
    fastestCompletionDisplay: group.fastestCompletionDisplay,
    fastestActivityId: group.fastestActivityId,
    lastClearedAt: group.lastClearedAt,
    lastActivityId: group.lastActivityId,
    scannedCompletions: group.scannedCompletions,
    sherpaCompletions: group.sherpaCompletions,
    fireteamSizes: group.fireteamSizes,
    tags: [...group.tags],
    flawless: group.flawless,
    sortOrder: group.sortOrder
  };
}

function finalizeActivityGroup(group: ActivityOverviewGroup): ActivityModeOverviewActivity {
  return {
    name: group.name,
    activityHashes: [...group.activityHashes].sort((a, b) => a - b),
    pgcrImage: group.pgcrImage,
    clears: group.completions,
    completions: group.completions,
    wins: group.wins,
    kills: group.kills,
    deaths: group.deaths,
    secondsPlayed: group.secondsPlayed,
    fastestCompletionMs: group.fastestCompletionMs,
    fastestCompletionDisplay: group.fastestCompletionDisplay,
    fastestActivityId: group.fastestActivityId,
    lastClearedAt: group.lastClearedAt,
    lastActivityId: group.lastActivityId
  };
}

function finalizeGrandmasterGroup(group: GrandmasterOverviewGroup): GrandmasterStrikeSummary {
  const completionsForAverage = group.completions > 0 ? group.completions : group.lifetimeClears;
  return {
    name: group.name,
    activityHashes: [...group.activityHashes].sort((a, b) => a - b),
    pgcrImage: group.pgcrImage,
    currentSeasonClears: group.currentSeasonClears,
    lifetimeClears: group.lifetimeClears,
    attempts: group.attempts,
    completions: group.completions,
    kills: group.kills,
    deaths: group.deaths,
    secondsPlayed: group.secondsPlayed,
    fastestCompletionMs: group.fastestCompletionMs,
    fastestCompletionDisplay: group.fastestCompletionDisplay,
    fastestActivityId: group.fastestActivityId,
    averageCompletionSeconds: completionsForAverage > 0 ? Math.round(group.secondsPlayed / completionsForAverage) : undefined,
    completionRate: group.attempts > 0 ? round((group.currentSeasonClears / group.attempts) * 100) : 0,
    lastClearedAt: group.lastClearedAt,
    lastActivityId: group.lastActivityId
  };
}

function grandmasterActivityInSeason(
  period: string,
  scope: GrandmasterSeasonScope,
  activeSeason: SeasonWindow | undefined
): boolean {
  if (scope === "all") {
    return true;
  }
  if (!activeSeason) {
    return true;
  }
  const periodMs = new Date(period).getTime();
  const startMs = new Date(activeSeason.startDate).getTime();
  const endMs = new Date(activeSeason.endDate).getTime();
  return Number.isFinite(periodMs) && Number.isFinite(startMs) && Number.isFinite(endMs) && periodMs >= startMs && periodMs <= endMs;
}

function toGrandmasterRecentPlayer(player: PgcrPlayerSummary): GrandmasterRecentPlayer {
  return {
    displayName: player.displayName,
    membershipId: player.membershipId,
    emblemPath: player.emblemPath,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    kd: player.kd,
    completed: player.completed,
    weapons: player.weapons.slice(0, 3)
  };
}

function formatDurationSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function addHeatmapBucket(
  buckets: Map<string, HeatmapBucket>,
  key: string,
  completed: number,
  kills: number,
  deaths: number,
  secondsPlayed: number
): void {
  const bucket = buckets.get(key) ?? {
    key,
    activities: 0,
    completed: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0
  };
  bucket.activities += 1;
  bucket.completed += completed;
  bucket.kills += kills;
  bucket.deaths += deaths;
  bucket.secondsPlayed += secondsPlayed;
  buckets.set(key, bucket);
}

function activityMatchesHeatmapRange(period: string, timezone: string, range: HeatmapRange, year: number | undefined): boolean {
  if (range !== "year") {
    return true;
  }
  if (year === undefined) {
    return true;
  }
  return Number(heatmapKeys(period, timezone).day.slice(0, 4)) === year;
}

function heatmapErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "unknown heatmap scan error");
}

function scanErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "unknown scan error");
}

function buildHeatmapCalendar(days: HeatmapBucket[], range: HeatmapRange, targetYear: number | undefined): HeatmapCalendarYear[] {
  const buckets = new Map(days.map((day) => [day.key, day]));
  const years = calendarYearRange(days, range, targetYear);
  const maxActivities = Math.max(1, ...days.map((day) => day.activities));
  return years.map((year) => {
    const months = calendarMonthsForYear(year, days, range, targetYear).map((month) =>
      buildHeatmapCalendarMonth(year, month, buckets, maxActivities)
    );
    return {
      year,
      totals: sumHeatmapBuckets(`${year}`, months.map((month) => month.totals)),
      months
    };
  });
}

function calendarYearRange(days: HeatmapBucket[], range: HeatmapRange, targetYear: number | undefined): number[] {
  if (range === "year" && targetYear !== undefined) {
    return [targetYear];
  }
  const years = days.map((day) => Number(day.key.slice(0, 4))).filter((year) => Number.isInteger(year));
  if (years.length === 0) {
    return [];
  }
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
}

function calendarMonthsForYear(year: number, days: HeatmapBucket[], range: HeatmapRange, targetYear: number | undefined): number[] {
  if (range === "year" && targetYear !== undefined) {
    return Array.from({ length: 12 }, (_, index) => index + 1);
  }
  const yearMonths = days
    .filter((day) => Number(day.key.slice(0, 4)) === year)
    .map((day) => Number(day.key.slice(5, 7)))
    .filter((month) => Number.isInteger(month));
  if (yearMonths.length === 0) {
    return Array.from({ length: 12 }, (_, index) => index + 1);
  }
  const minMonth = Math.min(...yearMonths);
  const maxMonth = Math.max(...yearMonths);
  return Array.from({ length: maxMonth - minMonth + 1 }, (_, index) => minMonth + index);
}

function buildHeatmapCalendarMonth(
  year: number,
  month: number,
  buckets: Map<string, HeatmapBucket>,
  maxActivities: number
): HeatmapCalendarYear["months"][number] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = mondayWeekday(year, month, 1);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const bucket = buckets.get(date) ?? emptyHeatmapBucket(date);
    return {
      ...bucket,
      date,
      day,
      weekday: mondayWeekday(year, month, day),
      week: Math.floor((firstWeekday + index) / 7),
      intensity: heatmapIntensity(bucket.activities, maxActivities)
    };
  });
  return {
    key: `${year}-${pad2(month)}`,
    year,
    month,
    label: `${year}年${month}月`,
    firstWeekday,
    daysInMonth,
    totals: sumHeatmapBuckets(`${year}-${pad2(month)}`, days),
    days
  };
}

function heatmapIntensity(activities: number, maxActivities: number): number {
  if (activities <= 0) {
    return 0;
  }
  const ratio = activities / Math.max(1, maxActivities);
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function sumHeatmapBuckets(key: string, buckets: HeatmapBucket[]): HeatmapBucket {
  return buckets.reduce(
    (total, bucket) => ({
      key,
      activities: total.activities + bucket.activities,
      completed: total.completed + bucket.completed,
      kills: total.kills + bucket.kills,
      deaths: total.deaths + bucket.deaths,
      secondsPlayed: total.secondsPlayed + bucket.secondsPlayed
    }),
    emptyHeatmapBucket(key)
  );
}

function emptyHeatmapBucket(key: string): HeatmapBucket {
  return {
    key,
    activities: 0,
    completed: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0
  };
}

function mondayWeekday(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function heatmapKeys(period: string, timezone: string): { day: string; hour: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(new Date(period));

  const year = datePart(parts, "year");
  const month = datePart(parts, "month");
  const day = datePart(parts, "day");
  const hour = datePart(parts, "hour").padStart(2, "0");
  return {
    day: `${year}-${month}-${day}`,
    hour
  };
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function fallbackPgcrDisplayName(membershipId: string | undefined): string {
  if (!membershipId) {
    return "匿名玩家";
  }
  return `ID ${membershipId.slice(-6)}`;
}

function combinePgcrPlayers(players: PgcrPlayerSummary[]): {
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kda: number;
} {
  const kills = players.reduce((sum, player) => sum + player.kills, 0);
  const deaths = players.reduce((sum, player) => sum + player.deaths, 0);
  const assists = players.reduce((sum, player) => sum + player.assists, 0);
  const deathsForRatio = deaths === 0 ? 1 : deaths;
  return {
    kills,
    deaths,
    assists,
    kd: round(kills / deathsForRatio),
    kda: round((kills + assists / 2) / deathsForRatio)
  };
}

function kdForPlayers(players: PgcrPlayerSummary[]): number {
  const kills = players.reduce((sum, player) => sum + player.kills, 0);
  const deaths = players.reduce((sum, player) => sum + player.deaths, 0);
  if (players.length === 0) {
    return 0;
  }
  return round(kills / (deaths === 0 ? 1 : deaths));
}

function aggregateMatchWeapons(weapons: WeaponUsageSummary[]): PvpMatchWeaponSummary[] {
  const merged = new Map<string, PvpMatchWeaponSummary>();
  for (const weapon of weapons) {
    const existing = merged.get(weapon.referenceId);
    if (existing) {
      existing.kills += weapon.kills;
      existing.precisionKills += weapon.precisionKills;
      existing.secondsUsed += weapon.secondsUsed;
    } else {
      merged.set(weapon.referenceId, {
        ...weapon,
        precisionRate: 0
      });
    }
  }

  return [...merged.values()]
    .map((weapon) => ({
      ...weapon,
      precisionRate: weapon.kills > 0 ? round((weapon.precisionKills / weapon.kills) * 100, 1) : 0
    }))
    .sort((a, b) => b.kills - a.kills);
}

function aggregatePvpMatches(matches: PvpMatchSummary[]): PvpAggregateStats {
  const kills = matches.reduce((sum, match) => sum + match.kills, 0);
  const deaths = matches.reduce((sum, match) => sum + match.deaths, 0);
  const assists = matches.reduce((sum, match) => sum + match.assists, 0);
  const wins = matches.filter((match) => match.result === "win").length;
  const losses = matches.filter((match) => match.result === "loss").length;
  const deathsForRatio = deaths === 0 ? 1 : deaths;
  return {
    matchesScanned: matches.length,
    wins,
    losses,
    kills,
    deaths,
    assists,
    kd: round(kills / deathsForRatio),
    kda: round((kills + assists / 2) / deathsForRatio),
    winRate: matches.length > 0 ? round((wins / matches.length) * 100) : 0,
    bestKills: Math.max(0, ...matches.map((match) => match.kills)),
    bestKd: Math.max(0, ...matches.map((match) => match.kd)),
    flawlessMatches: matches.filter((match) => match.deaths === 0 && match.kills > 0).length
  };
}

function aggregatePvpWeapons(matches: PvpMatchSummary[]): PvpRecentWeaponSummary[] {
  const merged = new Map<string, PvpRecentWeaponSummary>();
  for (const match of matches) {
    const usedInMatch = new Set<string>();
    for (const weapon of match.weapons) {
      const existing = merged.get(weapon.referenceId);
      if (existing) {
        existing.kills += weapon.kills;
        existing.precisionKills += weapon.precisionKills;
        existing.secondsUsed += weapon.secondsUsed;
        if (!usedInMatch.has(weapon.referenceId)) {
          existing.matchesUsed += 1;
        }
      } else {
        merged.set(weapon.referenceId, {
          referenceId: weapon.referenceId,
          name: weapon.name,
          iconPath: weapon.iconPath,
          kills: weapon.kills,
          precisionKills: weapon.precisionKills,
          secondsUsed: weapon.secondsUsed,
          matchesUsed: 1
        });
      }
      usedInMatch.add(weapon.referenceId);
    }
  }
  return [...merged.values()].sort((a, b) => b.kills - a.kills || b.matchesUsed - a.matchesUsed);
}

function aggregatePvpModes(matches: PvpMatchSummary[]): PvpModeBreakdown[] {
  const groups = new Map<string, PvpModeBreakdown>();
  for (const match of matches) {
    const modeName = match.modeName ?? "PVP";
    const group = groups.get(modeName) ?? {
      modeName,
      matches: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      kd: 0,
      winRate: 0
    };
    group.matches += 1;
    group.wins += match.result === "win" ? 1 : 0;
    group.losses += match.result === "loss" ? 1 : 0;
    group.kills += match.kills;
    group.deaths += match.deaths;
    group.assists += match.assists;
    groups.set(modeName, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      kd: round(group.kills / (group.deaths === 0 ? 1 : group.deaths)),
      winRate: group.matches > 0 ? round((group.wins / group.matches) * 100) : 0
    }))
    .sort((a, b) => b.matches - a.matches);
}

function formatPvpScore(teams: unknown[], teamId: number | undefined): string | undefined {
  if (teamId === undefined || teams.length === 0) {
    return undefined;
  }
  const scores = teams
    .map((team) => asRecord(team))
    .map((team) => ({
      teamId: teamIdFromRecord(team),
      score: statBasicValue(team, "score")
    }))
    .filter((team) => Number.isFinite(team.teamId));
  const own = scores.find((team) => team.teamId === teamId);
  const other = scores.find((team) => team.teamId !== teamId);
  if (!own || !other) {
    return undefined;
  }
  return `${own.score} - ${other.score}`;
}

function teamIdFromRecord(team: Record<string, unknown>): number {
  const teamId = numberFrom(team.teamId, Number.NaN);
  return Number.isFinite(teamId) ? teamId : numberFrom(team.team, Number.NaN);
}

function mergeCharacterCraftables(characterCraftables: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const value of Object.values(characterCraftables)) {
    const craftables = asRecord(asRecord(value).craftables);
    for (const [itemHash, craftable] of Object.entries(craftables)) {
      const existing = merged.get(itemHash);
      const current = asRecord(craftable);
      if (!existing || craftableScore(current) > craftableScore(existing)) {
        merged.set(itemHash, current);
      }
    }
  }
  return merged;
}

function findCraftingRootNodeHash(characterCraftables: Record<string, unknown>): string | undefined {
  for (const value of Object.values(characterCraftables)) {
    const hash = optionalNumber(asRecord(value).craftingRootNodeHash) ?? optionalString(asRecord(value).craftingRootNodeHash);
    if (hash !== undefined) {
      return String(hash);
    }
  }
  return undefined;
}

function craftableScore(craftable: Record<string, unknown>): number {
  const failed = asArray(craftable.failedRequirementIndexes).length;
  return (asBoolean(craftable.visible, true) ? 100 : 0) - failed;
}

function compareCraftables(a: CraftableWeaponSummary, b: CraftableWeaponSummary): number {
  if (a.unlocked !== b.unlocked) {
    return a.unlocked ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function mergeProfileRecordComponents(profileResponse: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const addRecords = (records: Record<string, unknown>) => {
    for (const [recordHash, value] of Object.entries(records)) {
      const current = asRecord(value);
      const existing = merged.get(recordHash);
      if (!existing || catalystRecordComponentScore(current) > catalystRecordComponentScore(existing)) {
        merged.set(recordHash, current);
      }
    }
  };

  addRecords(asRecord(asRecord(asRecord(profileResponse.profileRecords).data).records));
  for (const characterRecord of Object.values(asRecord(asRecord(profileResponse.characterRecords).data))) {
    addRecords(asRecord(asRecord(characterRecord).records));
  }
  return merged;
}

function countProfileCollectibles(profileResponse: Record<string, unknown>): number {
  let count = Object.keys(asRecord(asRecord(asRecord(profileResponse.profileCollectibles).data).collectibles)).length;
  for (const characterCollectible of Object.values(asRecord(asRecord(profileResponse.characterCollectibles).data))) {
    count += Object.keys(asRecord(asRecord(characterCollectible).collectibles)).length;
  }
  return count;
}

function catalystRecordComponentScore(component: Record<string, unknown>): number {
  const objectives = asArray(component.objectives).map((objective) => asRecord(objective));
  const objectiveScore = objectives.reduce(
    (sum, objective) =>
      sum +
      (asBoolean(objective.complete) ? 100000 : 0) +
      numberFrom(objective.progress) +
      numberFrom(objective.completionValue),
    0
  );
  return (hasRecordState(component.state, 1) ? 1000000 : 0) + objectiveScore;
}

function isCatalystText(...values: unknown[]): boolean {
  return values.some((value) => /催化|catalyst/iu.test(String(value ?? "")));
}

function isLikelyCraftingPatternRecord(...values: unknown[]): boolean {
  const text = values.map((value) => String(value ?? "")).join(" ");
  if (!text.trim()) {
    return false;
  }
  return /深视|共振|模式|图纸|锻造|pattern|deepsight|resonance|extract|shape/iu.test(text) && !isCatalystText(text);
}

function catalystDisplayName(definition: RecordDefinition | undefined, fallback = "Unknown Catalyst"): string {
  return asString(definition?.displayProperties?.name, fallback);
}

function stripCatalystWords(value: string): string {
  return value
    .replace(/^\s*catalyst\s*[:：-]?\s*/iu, "")
    .replace(/\s*catalyst\s*$/iu, "")
    .replace(/催化剂/gu, "")
    .replace(/催化/gu, "")
    .replace(/[：:·\-|]+$/gu, "")
    .trim();
}

const CATALYST_WEAPON_ALIAS_GROUPS = [
  ["虫狙", "蠕虫低语", "低语", "whisper of the worm", "whisper"],
  ["挽歌", "the lament", "lament"],
  ["黑桃", "黑桃a", "ace of spades", "ace"],
  ["睡炮", "睡者之吼", "sleeper simulant", "sleeper"],
  ["烈日", "烈日弹丸", "sunshot"],
  ["三体", "三体坐观者", "trinity ghoul"],
  ["帝王蝶", "le monarque", "monarque"],
  ["枯萎", "枯萎囤积", "withhoard"],
  ["雷神", "雷神机枪", "thunderlord"],
  ["加拉尔", "加拉尔号角", "gjallarhorn", "gjally"]
] as const;

const CATALYST_WEAPON_ALIAS_FALLBACKS: Array<{
  terms: readonly string[];
  weaponName: string;
  itemTypeDisplayName?: string;
  slot?: CatalystSlot;
}> = [
  {
    terms: ["虫狙", "蠕虫低语", "低语", "whisper of the worm", "whisper"],
    weaponName: "蠕虫低语",
    itemTypeDisplayName: "狙击步枪",
    slot: "power"
  },
  {
    terms: ["挽歌", "the lament", "lament"],
    weaponName: "挽歌",
    itemTypeDisplayName: "刀剑",
    slot: "power"
  },
  {
    terms: ["睡炮", "睡者之吼", "sleeper simulant", "sleeper"],
    weaponName: "睡者之吼",
    itemTypeDisplayName: "线性融合步枪",
    slot: "power"
  },
  {
    terms: ["加拉尔", "加拉尔号角", "gjallarhorn", "gjally"],
    weaponName: "加拉尔号角",
    itemTypeDisplayName: "火箭发射器",
    slot: "power"
  }
];

function normalizeCatalystMatchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s'’"“”《》:：·\-|/\\()[\]{}]+/gu, "")
    .trim();
}

function normalizeCatalystInfoSearchText(value: string): string {
  return normalizeCatalystMatchName(
    value
      .replace(/催化剂|催化效果|催化进度|催化|效果|查询一下|查询下|查询|查一下|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|我需要|需要|我的|我|有没有|有没|是否|是什么|什么|的/gu, "")
      .trim()
  );
}

function catalystSearchTerms(query: string): string[] {
  const normalized = normalizeCatalystInfoSearchText(query);
  const terms = new Set<string>();
  if (normalized) {
    terms.add(normalized);
  }
  for (const group of CATALYST_WEAPON_ALIAS_GROUPS) {
    const normalizedGroup = group.map((entry) => normalizeCatalystMatchName(entry)).filter(Boolean);
    if (
      normalizedGroup.some(
        (entry) =>
          entry === normalized ||
          (entry.length >= 2 && normalized.includes(entry)) ||
          (normalized.length >= 2 && entry.includes(normalized))
      )
    ) {
      for (const entry of normalizedGroup) {
        terms.add(entry);
      }
    }
  }
  return [...terms];
}

function catalystAliasFallbackFor(...values: Array<string | undefined>): (typeof CATALYST_WEAPON_ALIAS_FALLBACKS)[number] | undefined {
  const normalizedValues = new Set<string>();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      continue;
    }
    const normalized = normalizeCatalystInfoSearchText(raw) || normalizeCatalystMatchName(raw);
    if (normalized) {
      normalizedValues.add(normalized);
    }
    for (const term of catalystSearchTerms(raw)) {
      normalizedValues.add(term);
    }
  }

  for (const fallback of CATALYST_WEAPON_ALIAS_FALLBACKS) {
    const terms = fallback.terms.map((term) => normalizeCatalystMatchName(term)).filter(Boolean);
    if (
      terms.some((term) =>
        [...normalizedValues].some(
          (value) => value === term || (term.length >= 2 && value.includes(term)) || (value.length >= 2 && term.includes(value))
        )
      )
    ) {
      return fallback;
    }
  }
  return undefined;
}

function catalystInfoMatchScore(
  query: string,
  values: {
    weaponName?: string;
    recordName?: string;
    recordDescription?: string;
    catalystItemName?: string;
    catalystItemDescription?: string;
  }
): { score: number; reason: string } | null {
  const normalizedQueries = catalystSearchTerms(query);
  if (normalizedQueries.length === 0) {
    return null;
  }
  const candidates: Array<[string, string, number]> = [
    ["武器名", values.weaponName ?? "", 0],
    ["催化记录", stripCatalystWords(values.recordName ?? ""), 10],
    ["催化名", values.recordName ?? "", 20],
    ["催化物品", values.catalystItemName ?? "", 30],
    ["催化说明", values.catalystItemDescription ?? "", 50],
    ["记录说明", values.recordDescription ?? "", 60]
  ];
  for (const [reason, raw, baseScore] of candidates) {
    const normalized = normalizeCatalystMatchName(raw);
    if (!normalized) {
      continue;
    }
    for (const normalizedQuery of normalizedQueries) {
      if (normalized === normalizedQuery) {
        return { score: baseScore, reason: `${reason}精确匹配` };
      }
      if (normalized.includes(normalizedQuery)) {
        return { score: baseScore + 5, reason: `${reason}包含查询词` };
      }
      if (normalizedQuery.includes(normalized) && normalized.length >= 2) {
        return { score: baseScore + 8, reason: `${reason}被查询词包含` };
      }
    }
  }
  return null;
}

function findCatalystWeaponHash(
  definition: RecordDefinition,
  recordName: string,
  inventoryDefinitions: Record<string, InventoryItemDefinition>
): string | undefined {
  const rewardHashes = extractItemHashes(definition);
  for (const hash of rewardHashes) {
    const item = inventoryDefinitions[hash];
    if (item && isLikelyWeaponItem(item)) {
      return hash;
    }
  }

  const cleanName = normalizeCatalystMatchName(stripCatalystWords(recordName));
  if (cleanName.length >= 2) {
    for (const [hash, item] of Object.entries(inventoryDefinitions)) {
      const itemName = normalizeCatalystMatchName(asString(item.displayProperties?.name));
      if (itemName === cleanName && isLikelyWeaponItem(item)) {
        return hash;
      }
    }
  }

  return undefined;
}

function findCatalystItemHash(
  definition: RecordDefinition,
  weaponHash: string | undefined,
  inventoryDefinitions: Record<string, InventoryItemDefinition>
): string | undefined {
  const rewardHashes = extractItemHashes(definition).filter((hash) => hash !== weaponHash);
  const catalystHash = rewardHashes.find((hash) => {
    const item = inventoryDefinitions[hash];
    return item && isLikelyCatalystInventoryItem(item);
  });
  if (catalystHash) {
    return catalystHash;
  }

  const recordName = catalystDisplayName(definition, "");
  const normalizedRecordName = normalizeCatalystMatchName(recordName);
  if (normalizedRecordName.length >= 2) {
    const byName = Object.entries(inventoryDefinitions).find(([, item]) => {
      const itemName = normalizeCatalystMatchName(asString(item.displayProperties?.name));
      return itemName === normalizedRecordName && isLikelyCatalystInventoryItem(item);
    });
    if (byName) {
      return byName[0];
    }

    const byContainedName = Object.entries(inventoryDefinitions).find(([, item]) => {
      const itemName = normalizeCatalystMatchName(asString(item.displayProperties?.name));
      return itemName.includes(normalizedRecordName) && isLikelyCatalystInventoryItem(item);
    });
    if (byContainedName) {
      return byContainedName[0];
    }
  }

  return rewardHashes.find((hash) => {
    const item = inventoryDefinitions[hash];
    return item && !isLikelyWeaponItem(item);
  });
}

function isLikelyCatalystInventoryItem(item: InventoryItemDefinition): boolean {
  const traitIds = asArray(item.traitIds).map((entry) => String(entry).toLowerCase());
  return (
    traitIds.some((entry) => entry.includes("exotic_catalyst") || entry.includes("catalyst")) ||
    isCatalystText(item.displayProperties?.name, item.displayProperties?.description, item.itemTypeDisplayName)
  );
}

function catalystEffectDescriptionFromPerks(
  catalystDefinition: InventoryItemDefinition | undefined,
  sandboxPerkDefinitions: Record<string, SandboxPerkDefinition>
): string | undefined {
  const perkHashes = asArray(catalystDefinition?.perks)
    .map((perk) => {
      const record = asRecord(perk);
      const value = optionalNumber(record.perkHash) ?? optionalString(record.perkHash);
      return value === undefined ? undefined : String(value);
    })
    .filter((hash): hash is string => Boolean(hash));

  for (const perkHash of perkHashes) {
    const definition = sandboxPerkDefinitions[perkHash];
    if (!definition || definition.isDisplayable === false) {
      continue;
    }
    const name = optionalString(definition.displayProperties?.name);
    const description = optionalString(definition.displayProperties?.description);
    if (!description || isGenericCatalystObjectiveText(description)) {
      continue;
    }
    return name ? `${name}：${description}` : description;
  }
  return undefined;
}

function isGenericCatalystObjectiveText(value: string | undefined): boolean {
  const text = String(value ?? "").trim();
  return (
    !text ||
    /使用.*击败目标|使用.*消灭目标|击败目标|消灭目标|完成目标|将此武器升级为大师杰作|use .*defeat|defeat targets|masterwork/iu.test(
      text
    )
  );
}

function extractItemHashes(value: unknown, depth = 0): string[] {
  if (depth > 4) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractItemHashes(entry, depth + 1));
  }
  const record = asRecord(value);
  const hashes: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    if (/itemhash$/iu.test(key) || key === "displayItemHash") {
      const hash = optionalNumber(entry) ?? optionalString(entry);
      if (hash !== undefined) {
        hashes.push(String(hash));
      }
    }
    if (typeof entry === "object" && entry !== null) {
      hashes.push(...extractItemHashes(entry, depth + 1));
    }
  }
  return [...new Set(hashes)];
}

function isLikelyWeaponItem(item: InventoryItemDefinition): boolean {
  const bucketHash = optionalNumber(item.inventory?.bucketTypeHash) ?? numberFrom(item.inventory?.bucketTypeHash, Number.NaN);
  if (KINETIC_BUCKET_HASHES.has(bucketHash) || ENERGY_BUCKET_HASHES.has(bucketHash) || POWER_BUCKET_HASHES.has(bucketHash)) {
    return true;
  }
  const typeName = asString(item.itemTypeDisplayName).toLowerCase();
  return /步枪|手炮|弓|榴弹|霰弹|狙击|机枪|火箭|融合|剑|sidearm|rifle|cannon|bow|launcher|shotgun|sniper|machine|rocket|fusion|sword|glaive|smg|trace|grenade/iu.test(
    typeName
  );
}

function toCatalystObjectives(
  component: Record<string, unknown> | undefined,
  definition: RecordDefinition
): CatalystObjectiveSummary[] {
  const componentObjectives = asArray(asRecord(component).objectives)
    .map((objective, index) => toCatalystObjective(asRecord(objective), String(index)))
    .filter((objective) => objective.objectiveHash.length > 0);
  if (componentObjectives.length > 0) {
    return componentObjectives;
  }

  return asArray(definition.objectiveHashes)
    .map((hash, index) => {
      const objectiveHash = optionalNumber(hash) ?? optionalString(hash);
      return {
        objectiveHash: objectiveHash === undefined ? String(index) : String(objectiveHash),
        progress: 0,
        completionValue: 0,
        complete: false
      };
    })
    .filter((objective) => objective.objectiveHash.length > 0);
}

function toCatalystInfoObjectives(
  definition: RecordDefinition,
  objectiveDefinitions: Record<string, ObjectiveDefinition>
): CatalystInfoMatch["objectives"] {
  return asArray(definition.objectiveHashes)
    .map((hash, index) => {
      const objectiveHash = optionalNumber(hash) ?? optionalString(hash);
      const key = objectiveHash === undefined ? String(index) : String(objectiveHash);
      const objective = objectiveDefinitions[key];
      return {
        objectiveHash: key,
        description:
          optionalString(objective?.displayProperties?.description) ??
          optionalString(objective?.progressDescription) ??
          optionalString(objective?.displayProperties?.name),
        completionValue: optionalNumber(objective?.completionValue)
      };
    })
    .filter((objective) => objective.objectiveHash.length > 0);
}

function uniqueCatalystInfoMatches(matches: CatalystInfoMatch[]): CatalystInfoMatch[] {
  const byKey = new Map<string, CatalystInfoMatch>();
  for (const match of matches) {
    const key = match.recordHash || match.weaponHash || `${match.weaponName}:${match.catalystName}`;
    const existing = byKey.get(key);
    if (!existing || match.match.score < existing.match.score) {
      byKey.set(key, match);
    }
  }
  return [...byKey.values()];
}

function toCatalystStatusMatch(
  query: string,
  item: CatalystWeaponSummary,
  infoMatches: CatalystInfoMatch[],
  objectiveDefinitions: Record<string, ObjectiveDefinition>
): CatalystStatusMatch | null {
  const exactInfo = infoMatches.find(
    (info) =>
      info.recordHash === item.recordHash ||
      (info.weaponHash !== undefined && item.weaponHash !== undefined && info.weaponHash === item.weaponHash)
  );
  if (
    isLikelyCraftingPatternRecord(
      item.name,
      item.description,
      exactInfo?.catalystName,
      exactInfo?.catalystDescription,
      exactInfo?.effectDescription,
      exactInfo?.completionDescription
    )
  ) {
    return null;
  }
  const score =
    catalystInfoMatchScore(query, {
      weaponName: item.name,
      recordName: exactInfo?.catalystName,
      recordDescription: item.description,
      catalystItemName: exactInfo?.catalystName,
      catalystItemDescription: exactInfo?.effectDescription
    }) ??
    (exactInfo
      ? {
          score: exactInfo.match.score + 25,
          reason: exactInfo.match.reason
        }
      : null);
  if (!score) {
    return null;
  }

  const objectives = item.objectives.map((objective) => {
    const definition = objectiveDefinitions[objective.objectiveHash];
    return {
      ...objective,
      description:
        optionalString(definition?.displayProperties?.description) ??
        optionalString(definition?.progressDescription) ??
        optionalString(definition?.displayProperties?.name)
    };
  });
  const effectDescription =
    exactInfo?.effectDescription ??
    (isGenericCatalystObjectiveText(exactInfo?.catalystDescription) ? undefined : exactInfo?.catalystDescription) ??
    (isGenericCatalystObjectiveText(item.description) ? undefined : item.description) ??
    "Manifest 没有提供明确催化效果；下方显示的是完成目标。";
  const objectiveDescription = objectives
    .map((objective) => objective.description)
    .filter(Boolean)
    .join("；");
  const completionDescription = exactInfo?.completionDescription ?? (objectiveDescription || item.description);
  const aliasFallback = catalystAliasFallbackFor(
    query,
    item.name,
    item.description,
    exactInfo?.weaponName,
    exactInfo?.catalystName,
    exactInfo?.effectDescription,
    exactInfo?.completionDescription
  );
  const slot = item.slot === "unknown" && exactInfo?.slot && exactInfo.slot !== "unknown" ? exactInfo.slot : item.slot;
  const resolvedSlot = slot === "unknown" && aliasFallback?.slot ? aliasFallback.slot : slot;
  const itemTypeDisplayName =
    item.itemTypeDisplayName ?? exactInfo?.itemTypeDisplayName ?? aliasFallback?.itemTypeDisplayName;

  return {
    recordHash: item.recordHash,
    weaponHash: item.weaponHash,
    catalystItemHash: exactInfo?.catalystItemHash,
    weaponName: aliasFallback?.weaponName ?? exactInfo?.weaponName ?? item.name,
    catalystName: exactInfo?.catalystName ?? `${item.name}催化`,
    catalystDescription: exactInfo?.catalystDescription ?? item.description,
    effectDescription,
    completionDescription,
    iconPath: item.iconPath ?? exactInfo?.iconPath,
    itemTypeDisplayName,
    slot: resolvedSlot,
    slotLabel: CATALYST_SLOT_LABELS[resolvedSlot],
    obtained: item.obtained,
    visible: item.visible,
    completed: item.completed,
    redeemed: item.redeemed,
    percent: item.percent,
    progress: item.progress,
    completionValue: item.completionValue,
    objectives,
    infoObjectives: exactInfo?.objectives ?? [],
    statusLabel: catalystStatusLabel(item),
    match: score
  };
}

function catalystStatusLabel(item: CatalystWeaponSummary): string {
  if (item.completed) {
    return "已完成";
  }
  if (!item.visible) {
    return "当前不可见";
  }
  if (item.obtained) {
    return "已获得 / 进行中";
  }
  return "未获得";
}

function firstMeaningfulCatalystText(...values: Array<string | undefined>): string | undefined {
  const candidates = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0 && value !== "???");
  return candidates.find((value) => !/已添加至收藏品|可从收藏品重新获取/u.test(value)) ?? candidates[0];
}

function toCatalystObjective(objective: Record<string, unknown>, fallbackHash: string): CatalystObjectiveSummary {
  const objectiveHash = optionalNumber(objective.objectiveHash) ?? optionalString(objective.objectiveHash) ?? fallbackHash;
  const progress = Math.max(0, numberFrom(objective.progress));
  const completionValue = Math.max(0, numberFrom(objective.completionValue));
  const complete = asBoolean(objective.complete, completionValue > 0 && progress >= completionValue);
  return {
    objectiveHash: String(objectiveHash),
    progress,
    completionValue,
    complete,
    progressDescription: optionalString(objective.progressDescription)
  };
}

function hasRecordState(value: unknown, flag: number): boolean {
  const state = numberFrom(value, 0);
  return (state & flag) === flag;
}

function catalystSlotFromItem(item: InventoryItemDefinition | undefined): CatalystSlot {
  const bucketHash = optionalNumber(item?.inventory?.bucketTypeHash) ?? numberFrom(item?.inventory?.bucketTypeHash, Number.NaN);
  if (KINETIC_BUCKET_HASHES.has(bucketHash)) {
    return "kinetic";
  }
  if (ENERGY_BUCKET_HASHES.has(bucketHash)) {
    return "energy";
  }
  if (POWER_BUCKET_HASHES.has(bucketHash)) {
    return "power";
  }
  const bucketName = asString(item?.inventory?.bucketTypeName).toLowerCase();
  if (/动能|kinetic/u.test(bucketName)) {
    return "kinetic";
  }
  if (/能量|energy/u.test(bucketName)) {
    return "energy";
  }
  if (/威能|重武器|power|heavy/u.test(bucketName)) {
    return "power";
  }
  return "unknown";
}

function compareCatalysts(a: CatalystWeaponSummary, b: CatalystWeaponSummary): number {
  if (a.completed !== b.completed) {
    return a.completed ? 1 : -1;
  }
  if (a.visible !== b.visible) {
    return a.visible ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function firstDefined<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function fallbackActivityModeName(modeNumber: number): string | undefined {
  return ACTIVITY_MODE_LABELS.get(modeNumber);
}

function normalizeActivityModeName(modeName: string | undefined, modeNumber: number | undefined): string | undefined {
  const numericMode = Number.isFinite(modeNumber) ? modeNumber : undefined;
  const text = modeName?.trim();
  if (numericMode !== undefined && (!text || /^Mode\s+[0-9]+$/iu.test(text))) {
    return fallbackActivityModeName(numericMode) ?? text;
  }
  const match = /^Mode\s+([0-9]+)$/iu.exec(text ?? "");
  if (match) {
    return fallbackActivityModeName(Number(match[1])) ?? text;
  }
  return text;
}

interface CareerModeInfo {
  mode: string;
  label: string;
  bungieMode?: number;
  icon: string;
  tone: string;
}

interface SeasonDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
  };
  seasonNumber?: number;
  startDate?: string;
  endDate?: string;
  backgroundImagePath?: string;
  [key: string]: unknown;
}

interface SeasonWindow {
  name: string;
  startDate: string;
  endDate: string;
}

interface PresentationNodeDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
  };
  children?: {
    presentationNodes?: unknown[];
    craftables?: unknown[];
    records?: unknown[];
  };
  [key: string]: unknown;
}

interface InventoryItemDefinition {
  displayProperties?: {
    name?: string;
    icon?: string;
    description?: string;
  };
  itemTypeDisplayName?: string;
  classType?: number;
  inventory?: {
    bucketTypeHash?: string | number;
    bucketTypeName?: string;
    tierTypeName?: string;
  };
  sockets?: {
    socketEntries?: unknown[];
  };
  investmentStats?: unknown[];
  quality?: {
    displayVersionWatermarkIcons?: string[];
  };
  iconWatermark?: string;
  iconWatermarkShelved?: string;
  [key: string]: unknown;
}

interface InventoryBucketDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
  };
  [key: string]: unknown;
}

interface StatDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
  };
  [key: string]: unknown;
}

interface PlugSetDefinition {
  reusablePlugItems?: unknown[];
  [key: string]: unknown;
}

interface InventorySearchCriteria {
  query: string;
  weaponType?: string;
  rpm?: number;
  slot?: string;
  damageType?: string;
  perk?: string;
}

interface RecordDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
  };
  objectiveHashes?: unknown[];
  rewardItems?: unknown[];
  loreHash?: unknown;
  recordTypeName?: unknown;
  [key: string]: unknown;
}

interface ObjectiveDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
  };
  completionValue?: unknown;
  progressDescription?: unknown;
  [key: string]: unknown;
}

interface SandboxPerkDefinition {
  displayProperties?: {
    name?: string;
    description?: string;
    icon?: string;
  };
  isDisplayable?: boolean;
  [key: string]: unknown;
}

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

const INVENTORY_WEAPON_TYPE_ALIASES: Array<{ canonical: string; terms: string[] }> = [
  { canonical: "冲锋枪", terms: ["冲锋枪", "微冲", "微冲枪", "微型冲锋枪", "smg", "submachine gun", "submachinegun", "submachine"] },
  { canonical: "手炮", terms: ["手炮", "hc", "hand cannon", "handcannon"] },
  { canonical: "霰弹枪", terms: ["霰弹枪", "霰弹", "喷子", "shotgun"] },
  { canonical: "自动步枪", terms: ["自动步枪", "自动", "ar", "auto rifle", "autorifle"] },
  { canonical: "脉冲步枪", terms: ["脉冲步枪", "脉冲", "pulse rifle", "pulserifle", "pulse"] },
  { canonical: "斥候步枪", terms: ["斥候步枪", "斥候", "scout rifle", "scoutrifle", "scout"] },
  { canonical: "狙击步枪", terms: ["狙击步枪", "狙击枪", "狙击", "狙", "sniper rifle", "sniperrifle", "sniper"] },
  { canonical: "融合步枪", terms: ["融合步枪", "融合枪", "融合", "fusion rifle", "fusionrifle", "fusion"] },
  { canonical: "线性融合步枪", terms: ["线性融合步枪", "线性融合", "线融", "linear fusion rifle", "linear fusion", "linearfusion", "linear"] },
  { canonical: "榴弹发射器", terms: ["榴弹发射器", "榴弹", "gl", "grenade launcher", "grenadelauncher"] },
  { canonical: "火箭发射器", terms: ["火箭发射器", "火箭筒", "火箭", "筒子", "rocket launcher", "rocketlauncher", "rocket"] },
  { canonical: "机枪", terms: ["机枪", "mg", "machine gun", "machinegun"] },
  { canonical: "剑", terms: ["剑", "刀剑", "sword"] },
  { canonical: "弓", terms: ["弓", "bow"] },
  { canonical: "手枪", terms: ["手枪", "sidearm"] }
];

function inventorySearchCandidates(value: unknown): string[] {
  const raw = normalizeSearchText(value);
  const cleaned = normalizeInventorySearchPhrase(raw);
  return uniqueStrings([raw, cleaned, ...inventorySearchAliases(raw), ...inventorySearchAliases(cleaned)]).filter(Boolean);
}

function normalizeInventorySearchPhrase(value: string): string {
  return normalizeSearchText(value)
    .replace(/[，,。.!！?？、；;：:"“”'‘’《》【】[\]()（）{}<>/\\|·_\-]+/gu, " ")
    .replace(/\b(some|all|the|my|mine|in|of|from|find|search|vault|inventory|equipped|weapon|weapons)\b/giu, " ")
    .replace(
      /(命运2|仓库搜索|仓库|库存|背包|已装备|当前装备|身上装备|装备|帮我|我的|我|查询|查一下|查一查|查下|查看|查|搜索|搜一下|搜|寻找|找一下|找|看看|看|所有|全部|全都|一共|哪些|有哪些|有没有|有无|里面|里|中的|中|的)/gu,
      " "
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function inventorySearchAliases(value: string): string[] {
  const compact = normalizeInventorySearchPhrase(value).replace(/\s+/gu, "").toLowerCase();
  if (!compact) {
    return [];
  }
  const weaponType = normalizeInventoryWeaponType(compact);
  return weaponType ? [weaponType] : [];
}

function inventorySearchCriteria(options: {
  query?: string;
  weaponType?: string;
  rpm?: number;
  slot?: string;
  damageType?: string;
  perk?: string;
}): InventorySearchCriteria {
  const rawQuery = normalizeSearchText(options.query);
  const detectedWeaponType = inventoryWeaponTypeFromText(rawQuery);
  const explicitWeaponType = normalizeInventoryWeaponType(options.weaponType);
  const weaponType = explicitWeaponType ?? detectedWeaponType;
  const explicitRpm = parseInventoryRpm(options.rpm);
  const rpm = explicitRpm ?? inventoryRpmFromText(rawQuery, Boolean(weaponType));
  const slot = normalizeInventoryFilterText(options.slot);
  const damageType = normalizeInventoryFilterText(options.damageType);
  const perk = normalizeInventoryFilterText(options.perk);

  let query = normalizeInventorySearchPhrase(rawQuery);
  if (weaponType) {
    query = removeInventoryWeaponTypeWords(query, weaponType);
  }
  if (rpm !== undefined) {
    query = removeInventoryRpmWords(query, rpm);
  }
  query = normalizeInventorySearchPhrase(query);

  return {
    query,
    ...(weaponType ? { weaponType } : {}),
    ...(rpm !== undefined ? { rpm } : {}),
    ...(slot ? { slot } : {}),
    ...(damageType ? { damageType } : {}),
    ...(perk ? { perk } : {})
  };
}

function parseInventoryRpm(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2000 ? number : undefined;
}

function inventoryRpmFromText(value: string, hasWeaponType: boolean): number | undefined {
  const text = normalizeSearchText(value);
  const explicit = /(?:^|[^\d])([1-9][0-9]{1,3})\s*(?:rpm|r\/m|射速|每分钟发射数|每分钟发射|发\/分)/iu.exec(text);
  const explicitValue = parseInventoryRpm(explicit?.[1]);
  if (explicitValue !== undefined) {
    return explicitValue;
  }
  if (!hasWeaponType) {
    return undefined;
  }
  const numbers = [...text.matchAll(/(?:^|[^\d])([1-9][0-9]{1,3})(?!\d)/giu)]
    .map((match) => parseInventoryRpm(match[1]))
    .filter((number): number is number => number !== undefined);
  return numbers.length === 1 ? numbers[0] : undefined;
}

function normalizeInventoryWeaponType(value: unknown): string | undefined {
  const text = normalizeSearchText(value);
  if (!text) {
    return undefined;
  }
  for (const alias of INVENTORY_WEAPON_TYPE_ALIASES) {
    if (alias.terms.some((term) => inventoryTextHasTerm(text, term, true))) {
      return alias.canonical;
    }
  }
  return undefined;
}

function inventoryWeaponTypeFromText(value: string): string | undefined {
  const text = normalizeSearchText(value);
  if (!text) {
    return undefined;
  }
  for (const alias of INVENTORY_WEAPON_TYPE_ALIASES) {
    if (alias.terms.some((term) => inventoryTextHasTerm(text, term, false))) {
      return alias.canonical;
    }
  }
  return undefined;
}

function inventoryTextHasTerm(value: string, term: string, exact: boolean): boolean {
  const text = normalizeSearchText(value);
  const normalizedTerm = normalizeSearchText(term);
  if (!text || !normalizedTerm) {
    return false;
  }
  if (exact) {
    return text === normalizedTerm || text.replace(/\s+/gu, "") === normalizedTerm.replace(/\s+/gu, "");
  }
  return text.includes(normalizedTerm) || text.replace(/\s+/gu, "").includes(normalizedTerm.replace(/\s+/gu, ""));
}

function removeInventoryWeaponTypeWords(value: string, weaponType: string): string {
  const aliases = INVENTORY_WEAPON_TYPE_ALIASES.find((alias) => alias.canonical === weaponType);
  return (aliases?.terms ?? [weaponType]).reduce((text, term) => {
    const pattern = escapeRegExp(normalizeSearchText(term)).replace(/\s+/gu, "\\s*");
    return text.replace(new RegExp(pattern, "giu"), " ");
  }, value);
}

function removeInventoryRpmWords(value: string, rpm: number): string {
  return value
    .replace(new RegExp(`${rpm}\\s*(?:rpm|r\\/m|射速|每分钟发射数|每分钟发射|发\\/分)`, "giu"), " ")
    .replace(new RegExp(`${rpm}`, "gu"), " ");
}

function normalizeInventoryFilterText(value: unknown): string | undefined {
  const text = normalizeInventorySearchPhrase(String(value ?? ""));
  return text.length > 0 ? text : undefined;
}

function inventoryItemMatchesStructuredSearch(item: InventoryItemSummary, criteria: InventorySearchCriteria): boolean {
  if (criteria.weaponType && !inventoryItemMatchesText([criteria.weaponType], inventoryItemTypeText(item))) {
    return false;
  }
  if (criteria.rpm !== undefined && item.weaponStats?.rpm !== criteria.rpm) {
    return false;
  }
  if (criteria.slot && !inventoryItemMatchesText([criteria.slot], `${item.bucketName ?? ""}`)) {
    return false;
  }
  if (criteria.damageType && !inventoryItemMatchesText([criteria.damageType], `${item.damageType ?? ""}`)) {
    return false;
  }
  if (criteria.perk && !inventoryItemMatchesText(inventorySearchCandidates(criteria.perk), inventoryItemPlugText(item))) {
    return false;
  }
  return true;
}

function inventoryItemMatchesText(queries: string[], text: string): boolean {
  const normalized = normalizeSearchText(text);
  return queries.some((query) => normalized.includes(query) || inventorySearchCandidates(query).some((alias) => normalized.includes(alias)));
}

function inventoryItemTypeText(item: InventoryItemSummary): string {
  return `${item.itemTypeDisplayName ?? ""} ${item.bucketName ?? ""} ${item.name ?? ""}`;
}

function inventoryItemPlugText(item: InventoryItemSummary): string {
  return asArray(item.sockets)
    .flatMap((socket) => {
      const record = asRecord(socket);
      const selected = asRecord(record.selectedPlug);
      const reusable = asArray(record.reusablePlugs).map((plug) => asRecord(plug).name);
      return [selected.name, ...reusable];
    })
    .map((value) => String(value ?? ""))
    .join(" ");
}

function inventoryItemSearchText(item: InventoryItemSummary): string {
  const rpm = item.weaponStats?.rpm !== undefined ? `${item.weaponStats.rpm} rpm ${item.weaponStats.rpm}射速` : "";
  return normalizeSearchText(
    `${item.name} ${item.itemTypeDisplayName ?? ""} ${item.bucketName ?? ""} ${inventoryItemPlugText(item)} ${rpm}`
  );
}

function resolveInventoryTransferCharacters(
  inventory: InventorySummary,
  request: InventoryTransferItemsRequest
): InventoryTransferItemsRequest {
  const sourceCharacterId =
    request.source.characterId ||
    (request.source.className ? inventoryCharacterIdByClassName(inventory, request.source.className) : undefined);
  const destinationCharacterId =
    request.destination.characterId ||
    (request.destination.className ? inventoryCharacterIdByClassName(inventory, request.destination.className) : undefined);
  if (request.source.owner === "character" && !sourceCharacterId) {
    throw new BadRequestError("source.characterId or source.className is required when source.owner is character");
  }
  if (request.destination.owner === "character" && !destinationCharacterId) {
    throw new BadRequestError("destination.characterId or destination.className is required when destination.owner is character");
  }
  return {
    ...request,
    source: { ...request.source, ...(sourceCharacterId ? { characterId: sourceCharacterId } : {}) },
    destination: { ...request.destination, ...(destinationCharacterId ? { characterId: destinationCharacterId } : {}) }
  };
}

function inventoryCharacterIdByClassName(inventory: InventorySummary, className: string): string | undefined {
  const normalized = normalizeClassNameText(className);
  if (!normalized) {
    return undefined;
  }
  return inventory.characters.find((character) => normalizeClassNameText(character.className) === normalized)?.characterId;
}

function normalizeClassNameText(value: string): string {
  const text = normalizeSearchText(value).toLowerCase();
  if (/warlock|术士|術士|术/u.test(text)) return "warlock";
  if (/hunter|猎人|獵人|猎/u.test(text)) return "hunter";
  if (/titan|泰坦|坦/u.test(text)) return "titan";
  return text;
}

function buildInventoryTransferPlan(
  inventory: InventorySummary,
  request: InventoryTransferItemsRequest
): { plannedItems: InventoryItemSummary[]; skippedItems: InventoryTransferItemResult[] } {
  const skippedItems: InventoryTransferItemResult[] = [];
  const destinationCharacter =
    request.destination.owner === "character"
      ? inventory.characters.find((character) => character.characterId === request.destination.characterId)
      : undefined;
  const candidates = inventory.items.filter((item) => {
    const skipReason = inventoryTransferSkipReason(item, request, destinationCharacter);
    if (skipReason) {
      if (inventoryTransferSourceCouldMatch(item, request) && inventoryTransferFiltersCouldMatch(item, request)) {
        skippedItems.push(toInventoryTransferItemResult(item, request, "skipped", skipReason));
      }
      return false;
    }
    return inventoryTransferSourceCouldMatch(item, request) && inventoryTransferFiltersCouldMatch(item, request);
  });
  const plannedItems = candidates.slice(0, request.maxItems);
  for (const item of candidates.slice(request.maxItems)) {
    skippedItems.push(toInventoryTransferItemResult(item, request, "skipped", `超过本次 maxItems=${request.maxItems} 上限`));
  }
  return { plannedItems, skippedItems };
}

function inventoryTransferSkipReason(
  item: InventoryItemSummary,
  request: InventoryTransferItemsRequest,
  destinationCharacter: CharacterSummary | undefined
): string | undefined {
  if (!item.itemInstanceId) {
    return "物品没有 itemInstanceId，无法移动";
  }
  if (item.itemHash === undefined) {
    return "物品没有 itemHash，无法移动";
  }
  if (item.owner === "equipped" && !request.filters.includeEquipped) {
    return "已装备物品默认不移动";
  }
  if (item.owner !== "vault" && !item.characterId) {
    return "物品没有来源角色，无法移动";
  }
  if (item.transferStatus !== undefined && item.transferStatus !== 0) {
    return "Bungie 标记该物品不可转移";
  }
  if (request.destination.owner === "vault" && item.owner === "vault") {
    return "物品已经在仓库";
  }
  if (request.destination.owner === "character") {
    if (!request.destination.characterId) {
      return "目标角色缺失";
    }
    if (item.owner !== "vault" && item.characterId === request.destination.characterId) {
      return "物品已经在目标角色";
    }
    if (
      destinationCharacter &&
      item.classType !== undefined &&
      item.classType !== 3 &&
      item.classType !== destinationCharacter.classType &&
      inventoryTransferItemKind(item) === "armor"
    ) {
      return "防具职业与目标角色不匹配";
    }
  }
  return undefined;
}

function inventoryTransferSourceCouldMatch(item: InventoryItemSummary, request: InventoryTransferItemsRequest): boolean {
  const source = request.source;
  if (source.owner === "all") {
    return true;
  }
  if (source.owner === "character") {
    if (!source.characterId) {
      return false;
    }
    return item.owner !== "vault" && item.characterId === source.characterId;
  }
  if (source.owner !== item.owner) {
    return false;
  }
  if (source.characterId && item.characterId !== source.characterId) {
    return false;
  }
  return true;
}

function inventoryTransferFiltersCouldMatch(item: InventoryItemSummary, request: InventoryTransferItemsRequest): boolean {
  const filters = request.filters;
  if (filters.itemIds.length > 0 && (!item.itemInstanceId || !filters.itemIds.includes(item.itemInstanceId))) {
    return false;
  }
  if (filters.itemKind !== "all" && inventoryTransferItemKind(item) !== filters.itemKind) {
    return false;
  }
  if (filters.weaponType && !inventoryItemMatchesText([filters.weaponType], inventoryItemTypeText(item))) {
    return false;
  }
  if (filters.armorSlot && !inventoryTransferArmorSlotMatches(item, filters.armorSlot)) {
    return false;
  }
  if (filters.bucket && !inventoryItemMatchesText([filters.bucket], `${item.bucketName ?? ""}`)) {
    return false;
  }
  if (filters.locked !== null && filters.locked !== undefined && item.locked !== filters.locked) {
    return false;
  }
  const queries = inventorySearchCandidates(filters.q || "");
  if (queries.length > 0) {
    const itemText = inventoryItemSearchText(item);
    if (!queries.some((query) => itemText.includes(query))) {
      return false;
    }
  }
  return true;
}

function inventoryTransferItemKind(item: InventoryItemSummary): "weapon" | "armor" | "other" {
  const bucketHash = Number(item.bucketHash);
  if (KINETIC_BUCKET_HASHES.has(bucketHash) || ENERGY_BUCKET_HASHES.has(bucketHash) || POWER_BUCKET_HASHES.has(bucketHash)) {
    return "weapon";
  }
  if (ARMOR_BUCKETS[bucketHash]) {
    return "armor";
  }
  const text = normalizeSearchText(`${item.itemTypeDisplayName ?? ""} ${item.bucketName ?? ""}`);
  if (/武器|weapon|步枪|手炮|冲锋枪|机枪|手枪|弓|剑|榴弹|火箭|狙击|融合|霰弹/u.test(text)) {
    return "weapon";
  }
  if (/防具|护甲|头盔|臂铠|胸甲|腿甲|职业物品|armor|helmet|gauntlet|chest|leg|class item/u.test(text)) {
    return "armor";
  }
  return "other";
}

function inventoryTransferArmorSlotMatches(item: InventoryItemSummary, armorSlot: string): boolean {
  const normalized = normalizeInventoryArmorSlot(armorSlot);
  if (!normalized) {
    return false;
  }
  const bucket = item.bucketHash !== undefined ? ARMOR_BUCKETS[item.bucketHash] : undefined;
  if (bucket?.slot === normalized) {
    return true;
  }
  return inventoryItemMatchesText([armorSlot, bucket?.label ?? ""].filter(Boolean), `${item.bucketName ?? ""} ${item.itemTypeDisplayName ?? ""}`);
}

function normalizeInventoryArmorSlot(value: string): string | undefined {
  const text = normalizeSearchText(value);
  if (!text) {
    return undefined;
  }
  if (/头|头盔|helmet/u.test(text)) return "helmet";
  if (/手|臂|臂铠|手套|gauntlet|arm/u.test(text)) return "gauntlets";
  if (/胸|胸甲|chest/u.test(text)) return "chest";
  if (/腿|腿甲|leg|legs/u.test(text)) return "legs";
  if (/职业|职业物品|class/u.test(text)) return "class_item";
  return undefined;
}

function toInventoryTransferItemResult(
  item: InventoryItemSummary,
  request: InventoryTransferItemsRequest,
  status: "planned" | "moved" | "failed" | "skipped",
  message?: string
): InventoryTransferItemResult {
  const destinationCharacterId = request.destination.owner === "character" ? request.destination.characterId : undefined;
  return {
    itemId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: item.name,
    itemTypeDisplayName: item.itemTypeDisplayName,
    bucketName: item.bucketName,
    sourceOwner: item.owner,
    sourceCharacterId: item.characterId,
    destinationOwner: request.destination.owner,
    destinationCharacterId,
    ok: status === "moved" || status === "planned",
    status,
    message:
      message ||
      (status === "planned"
        ? "等待移动"
        : status === "moved"
          ? "已移动"
          : status === "skipped"
            ? "已跳过"
            : "移动失败")
  };
}

function requireInventoryItemInstanceId(item: InventoryItemSummary): string {
  if (!item.itemInstanceId) {
    throw new BadRequestError("itemInstanceId is required for transfer");
  }
  return item.itemInstanceId;
}

function requireInventoryItemCharacterId(item: InventoryItemSummary): string {
  if (!item.characterId) {
    throw new BadRequestError("source characterId is required for transfer");
  }
  return item.characterId;
}

function requireTransferDestinationCharacterId(request: InventoryTransferItemsRequest): string {
  if (request.destination.owner !== "character" || !request.destination.characterId) {
    throw new BadRequestError("destination.characterId is required");
  }
  return request.destination.characterId;
}

function friendlyTransferItemError(error: unknown): string {
  const status = String((error as { bungieErrorStatus?: unknown }).bungieErrorStatus ?? "");
  if (/CannotPerformAction|NotInOrbit|Character/i.test(status)) {
    return "Bungie 拒绝移动；通常需要角色在轨道、社交空间或离线";
  }
  if (/Transfer|Bucket|Full|Item/i.test(status)) {
    return "物品当前不可转移或目标背包已满";
  }
  return (error as { message?: string })?.message || "移动失败";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeSearchText(value)).filter(Boolean))];
}

function normalizeItemInfoSearchText(value: string): string {
  return String(value || "")
    .replace(/^\/+/u, " ")
    .replace(/(@\S+\s*)+/gu, " ")
    .replace(
      /命运2|destiny\s*2|destiny2|d2stats|d2|查个武器|武器查询|查武器|武器资料|物品查询|查询一下|查询下|查询|查一下|查一查|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|我需要|需要|这个|一下|一个|的|perk|perks|来源|出处|怎么获取|哪里出|怎么得|如何获得|是什么武器|是什么|什么|好不好用|好用吗|评价|资料/giu,
      " "
    )
    .replace(/[，,：:、。？?！!；;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeItemInfoMatchName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, "");
}

function itemInfoName(definition: InventoryItemDefinition | undefined, fallback = ""): string {
  return asString(definition?.displayProperties?.name, fallback);
}

function itemInfoMatchScore(
  query: string,
  definition: InventoryItemDefinition
): { score: number; reason: string } | null {
  const search = normalizeItemInfoMatchName(normalizeItemInfoSearchText(query));
  if (!search) {
    return null;
  }

  const source = itemInfoSource(definition) ?? "";
  const fields = [
    { label: "名称", value: itemInfoName(definition), base: 0 },
    { label: "类型", value: definition.itemTypeDisplayName, base: 35 },
    { label: "来源", value: source, base: 55 },
    { label: "描述", value: definition.displayProperties?.description, base: 70 }
  ];

  for (const field of fields) {
    const normalized = normalizeItemInfoMatchName(field.value);
    if (!normalized) {
      continue;
    }
    if (normalized === search) {
      return { score: field.base, reason: `${field.label}精确匹配` };
    }
    if (normalized.includes(search)) {
      return { score: field.base + Math.max(1, normalized.length - search.length), reason: `${field.label}包含查询词` };
    }
    if (search.includes(normalized) && normalized.length >= 2) {
      return { score: field.base + 25, reason: `查询词包含${field.label}` };
    }
  }

  return null;
}

function itemInfoSlotLabel(definition: InventoryItemDefinition | undefined): string | undefined {
  const bucketHash =
    optionalNumber(definition?.inventory?.bucketTypeHash) ?? numberFrom(definition?.inventory?.bucketTypeHash, Number.NaN);
  if (KINETIC_BUCKET_HASHES.has(bucketHash)) return "动能";
  if (ENERGY_BUCKET_HASHES.has(bucketHash)) return "能量";
  if (POWER_BUCKET_HASHES.has(bucketHash)) return "威能";
  return optionalString(definition?.inventory?.bucketTypeName);
}

function itemInfoDamageType(definition: InventoryItemDefinition | undefined): string | undefined {
  const direct =
    optionalString(asRecord(definition).damageTypeName) ??
    optionalString(asArray(asRecord(definition).damageTypeNames)[0]);
  if (direct) {
    return direct;
  }
  const damageType =
    optionalNumber(asRecord(definition).defaultDamageType) ??
    optionalNumber(asRecord(definition).damageType) ??
    numberFrom(asRecord(definition).defaultDamageType ?? asRecord(definition).damageType, Number.NaN);
  switch (damageType) {
    case 1:
      return "动能";
    case 2:
      return "电弧";
    case 3:
      return "烈日";
    case 4:
      return "虚空";
    case 6:
      return "冰影";
    case 7:
      return "缚丝";
    default:
      return undefined;
  }
}

function itemInfoAmmoType(definition: InventoryItemDefinition | undefined): string | undefined {
  const ammoType = optionalNumber(asRecord(definition?.equippingBlock).ammoType);
  switch (ammoType) {
    case 1:
      return "主弹药";
    case 2:
      return "特殊弹药";
    case 3:
      return "重弹药";
    default:
      return undefined;
  }
}

function itemInfoClassName(definition: InventoryItemDefinition | undefined): string | undefined {
  switch (optionalNumber(definition?.classType)) {
    case 0:
      return "泰坦";
    case 1:
      return "猎人";
    case 2:
      return "术士";
    default:
      return undefined;
  }
}

function itemInfoSource(definition: InventoryItemDefinition | undefined): string | undefined {
  const record = asRecord(definition);
  const direct = optionalString(record.displaySource) ?? optionalString(record.sourceString);
  if (direct) {
    return direct;
  }
  const sources = asArray(asRecord(record.sourceData).sources)
    .map((source) => optionalString(asRecord(source).sourceString) ?? optionalString(asRecord(source).description))
    .filter((value): value is string => Boolean(value));
  return sources[0];
}

function itemInfoStats(
  definition: InventoryItemDefinition | undefined,
  statDefinitions: Record<string, StatDefinition>
): ItemInfoMatch["stats"] {
  const seen = new Set<string>();
  const stats = asArray(definition?.investmentStats)
    .map((rawStat): ItemInfoMatch["stats"][number] | null => {
      const stat = asRecord(rawStat);
      const hash = optionalNumber(stat.statTypeHash) ?? numberFrom(stat.statTypeHash, Number.NaN);
      const value = optionalNumber(stat.value) ?? optionalNumber(stat.statValue);
      if (!Number.isFinite(hash) || value === undefined || !Number.isFinite(value) || value <= 0) {
        return null;
      }
      const hashText = String(hash);
      if (seen.has(hashText)) {
        return null;
      }
      seen.add(hashText);
      return {
        hash: hashText,
        name: optionalString(statDefinitions[hashText]?.displayProperties?.name) ?? (hash === WEAPON_RPM_STAT_HASH ? "RPM" : hashText),
        value
      };
    })
    .filter((stat): stat is ItemInfoMatch["stats"][number] => stat !== null);

  return stats
    .sort((left, right) => {
      if (left.hash === String(WEAPON_RPM_STAT_HASH)) return -1;
      if (right.hash === String(WEAPON_RPM_STAT_HASH)) return 1;
      return right.value - left.value;
    })
    .slice(0, 10);
}

function itemInfoPerks(
  definition: InventoryItemDefinition | undefined,
  inventoryDefinitions: Record<string, InventoryItemDefinition>,
  sandboxPerkDefinitions: Record<string, SandboxPerkDefinition>
): ItemInfoMatch["perks"] {
  const perks: ItemInfoMatch["perks"] = [];
  const seen = new Set<string>();
  const push = (itemHash: unknown, source: "sandbox" | "inventory") => {
    const hash = optionalNumber(itemHash) ?? numberFrom(itemHash, Number.NaN);
    if (!Number.isFinite(hash)) {
      return;
    }
    const key = `${source}:${hash}`;
    if (seen.has(key)) {
      return;
    }
    const definitionSource = source === "sandbox" ? sandboxPerkDefinitions[String(hash)] : inventoryDefinitions[String(hash)];
    const name = optionalString(definitionSource?.displayProperties?.name);
    if (!name || !isUsefulItemInfoPerkName(name, definitionSource?.displayProperties?.description)) {
      return;
    }
    seen.add(key);
    perks.push({
      itemHash: String(hash),
      name,
      description: optionalString(definitionSource?.displayProperties?.description),
      iconPath: optionalString(definitionSource?.displayProperties?.icon)
    });
  };

  for (const perk of asArray(asRecord(definition).perks)) {
    push(asRecord(perk).perkHash, "sandbox");
  }

  for (const socketEntry of asArray(definition?.sockets?.socketEntries)) {
    const entry = asRecord(socketEntry);
    push(entry.singleInitialItemHash, "inventory");
    for (const plug of asArray(entry.reusablePlugItems)) {
      push(asRecord(plug).plugItemHash, "inventory");
    }
  }

  return perks.slice(0, 14);
}

function normalizePerkWeaponInputs(value: string[] | string): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,，、+＋&＆/|]|(?:\s+(?:和|与|以及)\s*)/gu)
        .flatMap((part) => part.split(/\s+(?=[\u4e00-\u9fff]{2,})/gu));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawValues) {
    const cleaned = String(raw || "")
      .replace(/^\/+/u, "")
      .replace(/^[\s:：,，、+＋&＆/|]+|[\s:：,，、+＋&＆/|]+$/gu, "")
      .trim();
    const key = normalizeItemInfoMatchName(cleaned);
    if (!cleaned || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function perkWeaponRollPerksForDefinition(
  definition: InventoryItemDefinition | undefined,
  inventoryDefinitions: Record<string, InventoryItemDefinition>,
  plugSetDefinitions: Record<string, PlugSetDefinition>
): PerkWeaponPerkSummary[] {
  const perks: PerkWeaponPerkSummary[] = [];
  const seen = new Set<string>();
  const push = (
    itemHash: unknown,
    source: PerkWeaponPerkSummary["source"],
    socketIndex: number,
    plugSetHash?: string
  ) => {
    const hash = optionalNumber(itemHash) ?? numberFrom(itemHash, Number.NaN);
    if (!Number.isFinite(hash)) {
      return;
    }
    const hashText = String(hash);
    const definitionSource = inventoryDefinitions[hashText];
    const name = optionalString(definitionSource?.displayProperties?.name);
    if (!name || !isUsefulItemInfoPerkName(name, definitionSource?.displayProperties?.description)) {
      return;
    }
    const key = `${hashText}:${socketIndex}:${plugSetHash ?? source}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    perks.push({
      itemHash: hashText,
      name,
      description: optionalString(definitionSource?.displayProperties?.description),
      iconPath: optionalString(definitionSource?.displayProperties?.icon),
      socketIndex,
      ...(plugSetHash ? { plugSetHash } : {}),
      source
    });
  };

  for (const [socketIndex, rawSocketEntry] of asArray(definition?.sockets?.socketEntries).entries()) {
    const entry = asRecord(rawSocketEntry);
    push(entry.singleInitialItemHash, "initial", socketIndex);
    for (const plug of asArray(entry.reusablePlugItems)) {
      push(asRecord(plug).plugItemHash, "reusable", socketIndex);
    }
    for (const [field, source] of [
      ["reusablePlugSetHash", "reusablePlugSet"],
      ["randomizedPlugSetHash", "randomizedPlugSet"]
    ] as const) {
      const plugSetHash = optionalNumber(entry[field]) ?? numberFrom(entry[field], Number.NaN);
      if (!Number.isFinite(plugSetHash)) {
        continue;
      }
      const plugSetHashText = String(plugSetHash);
      const plugSet = plugSetDefinitions[plugSetHashText];
      for (const plug of asArray(plugSet?.reusablePlugItems)) {
        push(asRecord(plug).plugItemHash, source, socketIndex, plugSetHashText);
      }
    }
  }

  return perks;
}

function matchPerkWeaponInputs(perks: string[], rollPerks: PerkWeaponPerkSummary[]): PerkWeaponPerkSummary[] {
  const matches: PerkWeaponPerkSummary[] = [];
  const usedKeys = new Set<string>();
  for (const perk of perks) {
    const normalized = normalizeItemInfoMatchName(perk);
    const matched = rollPerks.find((candidate) => {
      const key = `${candidate.itemHash}:${candidate.socketIndex}:${candidate.plugSetHash ?? candidate.source}`;
      if (usedKeys.has(key)) {
        return false;
      }
      if (candidate.itemHash === perk) {
        return true;
      }
      const candidateName = normalizeItemInfoMatchName(candidate.name);
      return candidateName === normalized || candidateName.includes(normalized) || normalized.includes(candidateName);
    });
    if (!matched) {
      return [];
    }
    usedKeys.add(`${matched.itemHash}:${matched.socketIndex}:${matched.plugSetHash ?? matched.source}`);
    matches.push(matched);
  }
  return matches;
}

function perkWeaponDefinitionMatchesFilters(
  definition: InventoryItemDefinition,
  filters: {
    weaponType?: string;
    slot?: string;
    damageType?: string;
    rpm?: number;
    craftable?: boolean;
    query?: string;
  },
  craftableItems: Set<string>,
  itemHash: string
): boolean {
  if (filters.weaponType && !inventoryItemMatchesText([filters.weaponType], `${definition.itemTypeDisplayName ?? ""} ${definition.displayProperties?.name ?? ""}`)) {
    return false;
  }
  if (filters.slot && !inventoryItemMatchesText([filters.slot], `${itemInfoSlotLabel(definition) ?? ""} ${definition.inventory?.bucketTypeName ?? ""}`)) {
    return false;
  }
  if (filters.damageType && !inventoryItemMatchesText([filters.damageType], itemInfoDamageType(definition) ?? "")) {
    return false;
  }
  if (filters.rpm !== undefined && inventoryInvestmentStatValue(definition, WEAPON_RPM_STAT_HASH) !== filters.rpm) {
    return false;
  }
  if (filters.craftable !== undefined && craftableItems.has(itemHash) !== filters.craftable) {
    return false;
  }
  if (filters.query) {
    const text = normalizeSearchText(
      `${definition.displayProperties?.name ?? ""} ${definition.itemTypeDisplayName ?? ""} ${definition.displayProperties?.description ?? ""} ${itemInfoSource(definition) ?? ""}`
    );
    if (!inventoryItemMatchesText(inventorySearchCandidates(filters.query), text)) {
      return false;
    }
  }
  return true;
}

function perkWeaponMatchFromDefinition(
  itemHash: string,
  definition: InventoryItemDefinition,
  matchedPerks: PerkWeaponPerkSummary[],
  rollPerks: PerkWeaponPerkSummary[],
  craftableItems: Set<string>,
  statDefinitions: Record<string, StatDefinition>
): PerkWeaponMatch {
  const rpm = inventoryInvestmentStatValue(definition, WEAPON_RPM_STAT_HASH);
  const stats = itemInfoStats(definition, statDefinitions);
  const fallbackRpm = stats.find((stat) => stat.hash === String(WEAPON_RPM_STAT_HASH))?.value;
  return {
    itemHash,
    name: itemInfoName(definition, `Item ${itemHash}`),
    description: optionalString(definition.displayProperties?.description),
    iconPath: optionalString(definition.displayProperties?.icon),
    watermarkIconPath:
      optionalString(definition.iconWatermark) ??
      optionalString(definition.iconWatermarkShelved) ??
      optionalString(definition.quality?.displayVersionWatermarkIcons?.[0]),
    itemTypeDisplayName: optionalString(definition.itemTypeDisplayName),
    tierTypeName: optionalString(definition.inventory?.tierTypeName),
    bucketName: optionalString(definition.inventory?.bucketTypeName),
    slotLabel: itemInfoSlotLabel(definition),
    damageType: itemInfoDamageType(definition),
    ammoType: itemInfoAmmoType(definition),
    source: itemInfoSource(definition),
    craftable: craftableItems.has(itemHash),
    ...(rpm !== undefined || fallbackRpm !== undefined ? { rpm: rpm ?? fallbackRpm } : {}),
    matchedPerks,
    allRollPerks: rollPerks.slice(0, 80)
  };
}

function isUsefulItemInfoPerkName(name: string, description: string | undefined): boolean {
  const text = `${name} ${description ?? ""}`.toLowerCase();
  return !/空插槽|默认皮肤|默认着色器|默认装饰|击杀记录器|tracker|shader|ornament|memento|empty socket|disabled/u.test(text);
}

function inventoryOwnerCounts(items: InventoryItemSummary[]): InventorySummary["totals"] {
  return {
    items: items.length,
    vault: items.filter((item) => item.owner === "vault").length,
    inventory: items.filter((item) => item.owner === "inventory").length,
    equipped: items.filter((item) => item.owner === "equipped").length
  };
}

function isLockedInventoryItem(state: number | undefined): boolean {
  return state !== undefined && (state & 1) === 1;
}

function inventorySocketsForItem(
  definition: InventoryItemDefinition | undefined,
  socketComponent: Record<string, unknown>,
  reusablePlugComponent: Record<string, unknown>,
  inventoryDefinitions: Record<string, InventoryItemDefinition>,
  statDefinitions: Record<string, StatDefinition>
): { sockets?: InventorySocketSummary[] } {
  const rawSockets = asArray(socketComponent.sockets);
  if (rawSockets.length === 0) {
    return {};
  }

  const socketEntries = asArray(asRecord(definition?.sockets).socketEntries);
  const reusableBySocket = reusablePlugComponent.plugs;
  const sockets = rawSockets
    .map((rawSocket, index): InventorySocketSummary | null => {
      const socket = asRecord(rawSocket);
      const socketEntry = asRecord(socketEntries[index]);
      const selectedPlugHash = optionalNumber(socket.plugHash) ?? numberFrom(socket.plugHash, Number.NaN);
      const selectedPlug = Number.isFinite(selectedPlugHash)
        ? toInventoryPlugSummary(selectedPlugHash, inventoryDefinitions, statDefinitions, {
            selected: true,
            enabled: asBoolean(socket.isEnabled, true)
          })
        : undefined;
      const reusablePlugs = reusablePlugsForSocket(
        reusableBySocket,
        index,
        selectedPlugHash,
        inventoryDefinitions,
        statDefinitions
      );
      const socketTypeHash =
        optionalNumber(socketEntry.socketTypeHash) ??
        optionalNumber(socket.socketTypeHash) ??
        numberFrom(socketEntry.socketTypeHash, Number.NaN);

      if (!selectedPlug && reusablePlugs.length === 0) {
        return null;
      }

      return {
        socketIndex: index,
        name: inventorySocketDisplayName(index, selectedPlug, reusablePlugs),
        ...(Number.isFinite(socketTypeHash) ? { socketTypeHash } : {}),
        ...(Number.isFinite(selectedPlugHash) ? { selectedPlugHash } : {}),
        ...(selectedPlug ? { selectedPlug } : {}),
        reusablePlugs
      };
    })
    .filter((socket): socket is InventorySocketSummary => socket !== null);

  return sockets.length > 0 ? { sockets } : {};
}

function reusablePlugsForSocket(
  reusableBySocket: unknown,
  socketIndex: number,
  selectedPlugHash: number,
  inventoryDefinitions: Record<string, InventoryItemDefinition>,
  statDefinitions: Record<string, StatDefinition>
): InventoryPlugSummary[] {
  const rawPlugs = Array.isArray(reusableBySocket)
    ? asArray(reusableBySocket[socketIndex])
    : asArray(asRecord(reusableBySocket)[String(socketIndex)]);
  const seen = new Set<number>();
  const plugs: InventoryPlugSummary[] = [];

  for (const rawPlug of rawPlugs) {
    const plug = asRecord(rawPlug);
    const itemHash =
      optionalNumber(plug.plugItemHash) ??
      optionalNumber(plug.plugHash) ??
      numberFrom(plug.plugItemHash ?? plug.plugHash, Number.NaN);
    if (!Number.isFinite(itemHash) || seen.has(itemHash)) {
      continue;
    }
    seen.add(itemHash);
    plugs.push(
      toInventoryPlugSummary(itemHash, inventoryDefinitions, statDefinitions, {
        selected: itemHash === selectedPlugHash,
        enabled: asBoolean(plug.enabled, asBoolean(plug.canInsert, true))
      })
    );
  }

  return plugs.sort((left, right) => {
    if (left.selected !== right.selected) {
      return left.selected ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function toInventoryPlugSummary(
  itemHash: number,
  inventoryDefinitions: Record<string, InventoryItemDefinition>,
  statDefinitions: Record<string, StatDefinition>,
  options: { selected: boolean; enabled?: boolean }
): InventoryPlugSummary {
  const definition = inventoryDefinitions[String(itemHash)];
  const statModifiers = inventoryStatModifiersFromDefinition(definition, statDefinitions);
  return {
    itemHash,
    name: asString(definition?.displayProperties?.name, `Plug ${itemHash}`),
    iconPath: optionalString(definition?.displayProperties?.icon),
    description: optionalString(definition?.displayProperties?.description),
    ...(statModifiers.length > 0 ? { statModifiers } : {}),
    selected: options.selected,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {})
  };
}

function inventoryStatModifiersFromDefinition(
  definition: InventoryItemDefinition | undefined,
  statDefinitions: Record<string, StatDefinition>
): InventoryArmorStatSummary[] {
  return asArray(definition?.investmentStats)
    .map((rawStat): InventoryArmorStatSummary | null => {
      const stat = asRecord(rawStat);
      const hash = optionalNumber(stat.statTypeHash) ?? numberFrom(stat.statTypeHash, Number.NaN);
      const value = optionalNumber(stat.value) ?? optionalNumber(stat.statValue) ?? 0;
      if (!Number.isFinite(hash) || !ARMOR_STAT_HASHES.includes(hash as never) || value === 0) {
        return null;
      }
      const statDefinition = statDefinitions[String(hash)];
      return {
        hash,
        name: armorStatDisplayName(hash, statDefinition),
        value
      };
    })
    .filter((stat): stat is InventoryArmorStatSummary => stat !== null);
}

function inventorySocketDisplayName(
  index: number,
  selectedPlug: InventoryPlugSummary | undefined,
  reusablePlugs: InventoryPlugSummary[]
): string {
  const firstCandidate = reusablePlugs.find((plug) => !plug.selected);
  if (selectedPlug?.name) {
    return `插槽 ${index + 1}`;
  }
  if (firstCandidate?.name) {
    return `插槽 ${index + 1}`;
  }
  return `插槽 ${index + 1}`;
}

function inventoryArmorStatsForItem(
  definition: InventoryItemDefinition | undefined,
  statComponent: Record<string, unknown>,
  statDefinitions: Record<string, StatDefinition>
): { armorStats?: InventoryArmorStatsSummary } {
  const rawStats = asRecord(statComponent.stats);
  const hasArmorStatComponent = ARMOR_STAT_HASHES.some((hash) => rawStats[String(hash)] !== undefined);
  if (!hasArmorStatComponent) {
    return {};
  }
  const rows = ARMOR_STAT_HASHES.map((hash) => {
    const rawStat = asRecord(rawStats[String(hash)]);
    const value = optionalNumber(rawStat.value) ?? optionalNumber(rawStat.statValue) ?? 0;
    const statDefinition = statDefinitions[String(hash)];
    return {
      hash,
      name: armorStatDisplayName(hash, statDefinition),
      value
    };
  });

  if (!rows.some((row) => row.value > 0) && !inventoryDefinitionLooksLikeArmor(definition)) {
    return {};
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    armorStats: {
      total,
      stats: rows
    }
  };
}

function inventoryWeaponStatsForItem(
  definition: InventoryItemDefinition | undefined,
  statComponent: Record<string, unknown>,
  statDefinitions: Record<string, StatDefinition>
): { weaponStats?: { rpm?: number; stats: InventoryWeaponStatSummary[] } } {
  if (!inventoryDefinitionLooksLikeWeapon(definition)) {
    return {};
  }

  const rpm =
    inventoryStatComponentValue(statComponent, WEAPON_RPM_STAT_HASH) ??
    inventoryInvestmentStatValue(definition, WEAPON_RPM_STAT_HASH);
  if (rpm === undefined) {
    return {};
  }

  const statDefinition = statDefinitions[String(WEAPON_RPM_STAT_HASH)];
  return {
    weaponStats: {
      rpm,
      stats: [
        {
          hash: WEAPON_RPM_STAT_HASH,
          name: optionalString(statDefinition?.displayProperties?.name) ?? "RPM",
          value: rpm
        }
      ]
    }
  };
}

function inventoryStatComponentValue(statComponent: Record<string, unknown>, statHash: number): number | undefined {
  const rawStats = asRecord(statComponent.stats);
  const rawStat = asRecord(rawStats[String(statHash)]);
  const value = optionalNumber(rawStat.value) ?? optionalNumber(rawStat.statValue);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function inventoryInvestmentStatValue(
  definition: InventoryItemDefinition | undefined,
  statHash: number
): number | undefined {
  const row = asArray(definition?.investmentStats)
    .map((rawStat) => asRecord(rawStat))
    .find((stat) => {
      const hash = optionalNumber(stat.statTypeHash) ?? numberFrom(stat.statTypeHash, Number.NaN);
      return hash === statHash;
    });
  const value = optionalNumber(row?.value) ?? optionalNumber(row?.statValue);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function inventoryDefinitionLooksLikeWeapon(definition: InventoryItemDefinition | undefined): boolean {
  const bucketHash =
    optionalNumber(definition?.inventory?.bucketTypeHash) ?? numberFrom(definition?.inventory?.bucketTypeHash, Number.NaN);
  if (KINETIC_BUCKET_HASHES.has(bucketHash) || ENERGY_BUCKET_HASHES.has(bucketHash) || POWER_BUCKET_HASHES.has(bucketHash)) {
    return true;
  }
  const text = `${asString(definition?.itemTypeDisplayName)} ${asString(definition?.inventory?.bucketTypeName)}`.toLowerCase();
  return /weapon|rifle|cannon|shotgun|launcher|sword|bow|sidearm|glaive|武器|步枪|手炮|冲锋枪|霰弹|发射器|机枪|剑|弓|手枪|偃月/u.test(text);
}

function inventoryDefinitionLooksLikeArmor(definition: InventoryItemDefinition | undefined): boolean {
  const text = `${asString(definition?.itemTypeDisplayName)} ${asString(definition?.inventory?.bucketTypeName)}`.toLowerCase();
  return /armor|helmet|gauntlet|chest|leg|class item|头盔|臂铠|手套|胸甲|腿甲|护腿|职业物品|护甲/u.test(text);
}

function armorStatDisplayName(hash: number, statDefinition: StatDefinition | undefined): string {
  const manifestName = optionalString(statDefinition?.displayProperties?.name);
  if (manifestName && ARMOR_3_STAT_NAMES.has(manifestName)) {
    return manifestName;
  }
  return ARMOR_STAT_FALLBACK_NAMES[hash] ?? manifestName ?? String(hash);
}

function compareInventoryItems(left: InventoryItemSummary, right: InventoryItemSummary): number {
  const ownerOrder: Record<InventoryOwner, number> = { equipped: 0, inventory: 1, vault: 2 };
  const ownerDiff = ownerOrder[left.owner] - ownerOrder[right.owner];
  if (ownerDiff !== 0) {
    return ownerDiff;
  }
  const powerDiff = (right.power ?? 0) - (left.power ?? 0);
  if (powerDiff !== 0) {
    return powerDiff;
  }
  return left.name.localeCompare(right.name);
}

type OptimizerStatKey = keyof typeof LOADOUT_OPTIMIZER_STAT_HASHES;
type OptimizerStats = Record<OptimizerStatKey, number>;

interface OptimizerArmorCandidate {
  slot: string;
  slotLabel: string;
  item: InventoryItemSummary;
  baseStats: OptimizerStats;
  currentStats: OptimizerStats;
  removedStatMods: InventoryPlugSummary[];
  exotic: boolean;
  rankScore: number;
}

interface OptimizerPartialArmorSet {
  armor: OptimizerArmorCandidate[];
  stats: OptimizerStats;
  exoticCount: number;
}

interface OptimizerFragmentCombo {
  fragments: LoadoutOptimizerFragmentSuggestion[];
  stats: OptimizerStats;
}

interface OptimizerModPlan {
  stats: OptimizerStats;
  statMods: LoadoutOptimizerStatModSuggestion[];
  missing: LoadoutOptimizerStatValue[];
  waste: number;
  achieved: boolean;
}

function buildOptimizerSearch(
  inventory: InventorySummary,
  character: CharacterSummary,
  targets: LoadoutOptimizerTargetStat[],
  options: { includeCurrentSubclassFragments: boolean; simulateStatMods: boolean; limit: number }
): Pick<LoadoutOptimizerSearchSummary, "builds" | "scan"> {
  const targetKeys = targets.map((target) => target.key as OptimizerStatKey);
  const armorItems = inventory.items
    .map((item) => toOptimizerArmorCandidate(item, character.classType, targetKeys))
    .filter((item): item is OptimizerArmorCandidate => item !== null);
  const grouped = new Map<string, OptimizerArmorCandidate[]>();
  for (const candidate of armorItems) {
    const list = grouped.get(candidate.slot) ?? [];
    list.push(candidate);
    grouped.set(candidate.slot, list);
  }
  for (const slot of ARMOR_SLOT_ORDER) {
    grouped.set(slot, pruneOptimizerArmorCandidates(grouped.get(slot) ?? [], targetKeys));
  }

  let partials: OptimizerPartialArmorSet[] = [{ armor: [], stats: emptyOptimizerStats(), exoticCount: 0 }];
  let truncated = false;
  for (const slot of ARMOR_SLOT_ORDER) {
    const candidates = grouped.get(slot) ?? [];
    const next: OptimizerPartialArmorSet[] = [];
    for (const partial of partials) {
      for (const candidate of candidates) {
        const exoticCount = partial.exoticCount + (candidate.exotic ? 1 : 0);
        if (exoticCount > 1) {
          continue;
        }
        next.push({
          armor: [...partial.armor, candidate],
          stats: addOptimizerStats(partial.stats, candidate.baseStats),
          exoticCount
        });
      }
    }
    if (next.length > LOADOUT_OPTIMIZER_MAX_PARTIALS) {
      truncated = true;
    }
    partials = next
      .sort((left, right) => rankOptimizerPartial(right, targets) - rankOptimizerPartial(left, targets))
      .slice(0, LOADOUT_OPTIMIZER_MAX_PARTIALS);
  }

  const fragmentCombos = options.includeCurrentSubclassFragments
    ? currentSubclassFragmentCombos(inventory, character)
    : [{ fragments: [], stats: emptyOptimizerStats() }];
  const candidates: LoadoutOptimizerBuild[] = [];
  let evaluated = 0;
  for (const partial of partials) {
    if (partial.armor.length !== ARMOR_SLOT_ORDER.length) {
      continue;
    }
    for (const fragmentCombo of fragmentCombos) {
      evaluated += 1;
      const statsBeforeMods = addOptimizerStats(partial.stats, fragmentCombo.stats);
      const modPlan = bestOptimizerModPlan(statsBeforeMods, targets, options.simulateStatMods);
      candidates.push(
        toLoadoutOptimizerBuild(partial, fragmentCombo, modPlan, targets, candidates.length + 1, options.simulateStatMods)
      );
    }
  }

  const builds = candidates
    .sort(compareLoadoutOptimizerBuilds)
    .slice(0, options.limit)
    .map((build, index) => ({ ...build, rank: index + 1, buildId: `b${index + 1}` }));

  return {
    builds,
    scan: {
      armorItems: armorItems.length,
      candidateArmorItems: Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0),
      armorCombinations: partials.length,
      fragmentCombinations: fragmentCombos.length,
      truncated: truncated || evaluated > partials.length * fragmentCombos.length
    }
  };
}

function toOptimizerArmorCandidate(
  item: InventoryItemSummary,
  classType: number,
  targetKeys: OptimizerStatKey[]
): OptimizerArmorCandidate | null {
  if (!item.itemInstanceId || !item.armorStats?.stats?.length) {
    return null;
  }
  const slot = optimizerArmorSlot(item);
  if (!slot) {
    return null;
  }
  if (!optimizerItemMatchesClass(item, classType)) {
    return null;
  }
  const currentStats = optimizerStatsFromArmorStats(item.armorStats.stats);
  const removedStatMods = selectedArmorStatModPlugs(item);
  const baseStats = subtractOptimizerStats(currentStats, optimizerStatsFromPlugs(removedStatMods));
  const rankScore =
    targetKeys.reduce((sum, key) => sum + baseStats[key], 0) +
    Object.values(baseStats).reduce((sum, value) => sum + value, 0) / 20 +
    (item.owner === "equipped" ? 2 : 0);
  return {
    slot: slot.slot,
    slotLabel: slot.label,
    item,
    baseStats,
    currentStats,
    removedStatMods,
    exotic: optimizerItemIsExotic(item),
    rankScore
  };
}

function optimizerArmorSlot(item: InventoryItemSummary): { slot: string; label: string; order: number } | null {
  if (item.bucketHash && ARMOR_BUCKETS[item.bucketHash]) {
    return ARMOR_BUCKETS[item.bucketHash];
  }
  const text = `${item.bucketName ?? ""} ${item.itemTypeDisplayName ?? ""}`.toLowerCase();
  if (/helmet|头盔/u.test(text)) return ARMOR_BUCKETS[3448274439];
  if (/gauntlet|臂铠|手套/u.test(text)) return ARMOR_BUCKETS[3551918588];
  if (/chest|胸甲/u.test(text)) return ARMOR_BUCKETS[14239492];
  if (/leg|腿甲|护腿/u.test(text)) return ARMOR_BUCKETS[20886954];
  if (/class item|职业物品/u.test(text)) return ARMOR_BUCKETS[1585787867];
  return null;
}

function optimizerItemMatchesClass(item: InventoryItemSummary, classType: number): boolean {
  return item.classType === undefined || item.classType === classType || item.classType === 3;
}

function optimizerItemIsExotic(item: InventoryItemSummary): boolean {
  return /异域|exotic/iu.test(`${item.tierTypeName ?? ""}`);
}

function selectedArmorStatModPlugs(item: InventoryItemSummary): InventoryPlugSummary[] {
  const sockets = Array.isArray(item.sockets) ? item.sockets : [];
  return sockets
    .map((socket) => socket.selectedPlug)
    .filter((plug): plug is InventoryPlugSummary => Boolean(plug?.statModifiers?.length))
    .filter(isLikelyArmorStatModPlug);
}

function isLikelyArmorStatModPlug(plug: InventoryPlugSummary): boolean {
  const text = `${plug.name} ${plug.description ?? ""}`.toLowerCase();
  const modifiers = plug.statModifiers ?? [];
  if (!modifiers.length || modifiers.some((modifier) => Math.abs(modifier.value) > 10)) {
    return false;
  }
  return /mod|模组|生命值|近战|手雷|超能|职业|武器|机动|韧性|恢复|纪律|智慧|力量|health|melee|grenade|super|class|weapon|mobility|resilience|recovery|discipline|intellect|strength/iu.test(text);
}

function pruneOptimizerArmorCandidates(
  candidates: OptimizerArmorCandidate[],
  targetKeys: OptimizerStatKey[]
): OptimizerArmorCandidate[] {
  return candidates
    .sort((left, right) => {
      const targetDelta =
        targetKeys.reduce((sum, key) => sum + right.baseStats[key], 0) -
        targetKeys.reduce((sum, key) => sum + left.baseStats[key], 0);
      if (targetDelta !== 0) return targetDelta;
      return right.rankScore - left.rankScore;
    })
    .slice(0, 70);
}

function currentSubclassFragmentCombos(inventory: InventorySummary, character: CharacterSummary): OptimizerFragmentCombo[] {
  const subclass = inventory.items.find(
    (item) => item.owner === "equipped" && item.characterId === character.characterId && optimizerItemLooksLikeSubclass(item)
  );
  const sockets = (subclass?.sockets ?? [])
    .map((socket) => optimizerFragmentOptions(socket))
    .filter((options) => options.length > 0)
    .slice(0, 5);
  if (sockets.length === 0) {
    return [{ fragments: [], stats: emptyOptimizerStats() }];
  }
  const combos: OptimizerFragmentCombo[] = [];
  const visit = (index: number, fragments: LoadoutOptimizerFragmentSuggestion[], stats: OptimizerStats) => {
    if (combos.length >= LOADOUT_OPTIMIZER_MAX_FRAGMENT_COMBOS) {
      return;
    }
    if (index >= sockets.length) {
      combos.push({ fragments, stats });
      return;
    }
    for (const option of sockets[index]) {
      visit(index + 1, [...fragments, option], addOptimizerStats(stats, optimizerStatsFromArmorStats(option.statModifiers)));
    }
  };
  visit(0, [], emptyOptimizerStats());
  return combos.length > 0 ? combos : [{ fragments: [], stats: emptyOptimizerStats() }];
}

function optimizerItemLooksLikeSubclass(item: InventoryItemSummary): boolean {
  const text = `${item.bucketName ?? ""} ${item.itemTypeDisplayName ?? ""} ${item.name}`.toLowerCase();
  return /subclass|分支职业|分支/u.test(text);
}

function optimizerFragmentOptions(socket: InventorySocketSummary): LoadoutOptimizerFragmentSuggestion[] {
  const plugs = [socket.selectedPlug, ...(socket.reusablePlugs ?? [])]
    .filter((plug): plug is InventoryPlugSummary => Boolean(plug?.statModifiers?.length))
    .filter((plug) => plug.enabled !== false);
  const seen = new Set<string>();
  const options: LoadoutOptimizerFragmentSuggestion[] = [];
  for (const plug of plugs) {
    const key = `${plug.itemHash}:${JSON.stringify(plug.statModifiers)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push({
      socketIndex: socket.socketIndex,
      name: plug.name,
      itemHash: plug.itemHash,
      iconPath: plug.iconPath,
      statModifiers: plug.statModifiers ?? []
    });
  }
  return options.slice(0, 16);
}

function bestOptimizerModPlan(
  baseStats: OptimizerStats,
  targets: LoadoutOptimizerTargetStat[],
  simulateStatMods: boolean
): OptimizerModPlan {
  const targetKeys = targets.map((target) => target.key as OptimizerStatKey);
  let best: OptimizerModPlan | null = null;
  const bonusesByKey = simulateStatMods ? targetKeys.map(() => optimizerStatBonusOptions()) : targetKeys.map(() => [0]);
  const visit = (index: number, bonuses: number[]) => {
    if (index >= targetKeys.length) {
      const modCount = bonuses.reduce((sum, bonus) => sum + optimizerStatModCount(bonus), 0);
      if (modCount > 5) {
        return;
      }
      const stats = { ...baseStats };
      const statMods: LoadoutOptimizerStatModSuggestion[] = [];
      for (let statIndex = 0; statIndex < targetKeys.length; statIndex += 1) {
        const key = targetKeys[statIndex];
        const bonus = bonuses[statIndex];
        stats[key] += bonus;
        if (bonus > 0) {
          statMods.push({
            statHash: LOADOUT_OPTIMIZER_STAT_HASHES[key],
            statKey: key,
            statName: LOADOUT_OPTIMIZER_STAT_LABELS[key],
            value: bonus,
            count: optimizerStatModCount(bonus)
          });
        }
      }
      const missing = optimizerMissingStats(stats, targets);
      const achieved = missing.every((entry) => (entry.deficit ?? 0) <= 0);
      const waste = optimizerWaste(stats, targets);
      const plan = { stats, statMods, missing, waste, achieved };
      if (!best || compareOptimizerModPlans(plan, best) < 0) {
        best = plan;
      }
      return;
    }
    for (const bonus of bonusesByKey[index]) {
      visit(index + 1, [...bonuses, bonus]);
    }
  };
  visit(0, []);
  return best ?? {
    stats: baseStats,
    statMods: [],
    missing: optimizerMissingStats(baseStats, targets),
    waste: optimizerWaste(baseStats, targets),
    achieved: false
  };
}

function optimizerStatBonusOptions(): number[] {
  return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
}

function optimizerStatModCount(bonus: number): number {
  if (bonus <= 0) return 0;
  return Math.ceil(bonus / 10);
}

function compareOptimizerModPlans(left: OptimizerModPlan, right: OptimizerModPlan): number {
  const leftMissing = optimizerMissingTotal(left.missing);
  const rightMissing = optimizerMissingTotal(right.missing);
  if (leftMissing !== rightMissing) return leftMissing - rightMissing;
  if (left.waste !== right.waste) return left.waste - right.waste;
  return left.statMods.reduce((sum, mod) => sum + mod.count, 0) - right.statMods.reduce((sum, mod) => sum + mod.count, 0);
}

function toLoadoutOptimizerBuild(
  partial: OptimizerPartialArmorSet,
  fragmentCombo: OptimizerFragmentCombo,
  modPlan: OptimizerModPlan,
  targets: LoadoutOptimizerTargetStat[],
  index: number,
  simulateStatMods: boolean
): LoadoutOptimizerBuild {
  const missingTotal = optimizerMissingTotal(modPlan.missing);
  const notes = [
    modPlan.achieved ? "达到目标属性。" : `未完全达标，仍缺 ${missingTotal} 点。`,
    simulateStatMods ? "属性模组为模拟建议，不会自动插入。" : "未模拟属性模组。",
    fragmentCombo.fragments.length ? "碎片需要按推荐手动调整。" : "未找到影响属性的当前分支碎片。"
  ];
  return {
    buildId: `raw-${index}`,
    rank: index,
    achieved: modPlan.achieved,
    score: optimizerBuildScore(modPlan, targets),
    waste: modPlan.waste,
    missing: modPlan.missing,
    stats: optimizerStatValues(modPlan.stats, targets),
    armor: partial.armor
      .slice()
      .sort((left, right) => armorSlotOrder(left.slot) - armorSlotOrder(right.slot))
      .map(toLoadoutOptimizerArmorItem),
    statMods: modPlan.statMods,
    fragments: fragmentCombo.fragments,
    notes
  };
}

function toLoadoutOptimizerArmorItem(candidate: OptimizerArmorCandidate): LoadoutOptimizerArmorItem {
  return {
    slot: candidate.slot,
    slotLabel: candidate.slotLabel,
    itemHash: candidate.item.itemHash,
    itemInstanceId: candidate.item.itemInstanceId ?? "",
    name: candidate.item.name,
    iconPath: candidate.item.iconPath,
    owner: candidate.item.owner,
    characterId: candidate.item.characterId,
    tierTypeName: candidate.item.tierTypeName,
    exotic: candidate.exotic,
    power: candidate.item.power,
    baseStats: optimizerStatValues(candidate.baseStats),
    currentStats: optimizerStatValues(candidate.currentStats),
    removedStatMods: candidate.removedStatMods
  };
}

function compareLoadoutOptimizerBuilds(left: LoadoutOptimizerBuild, right: LoadoutOptimizerBuild): number {
  if (left.achieved !== right.achieved) return left.achieved ? -1 : 1;
  const missingDelta = optimizerMissingTotal(left.missing) - optimizerMissingTotal(right.missing);
  if (missingDelta !== 0) return missingDelta;
  if (left.waste !== right.waste) return left.waste - right.waste;
  return right.score - left.score;
}

function optimizerBuildScore(plan: OptimizerModPlan, targets: LoadoutOptimizerTargetStat[]): number {
  const targetScore = targets.reduce((sum, target) => sum + Math.min(plan.stats[target.key as OptimizerStatKey], target.target), 0);
  return targetScore - optimizerMissingTotal(plan.missing) * 10 - plan.waste;
}

function rankOptimizerPartial(partial: OptimizerPartialArmorSet, targets: LoadoutOptimizerTargetStat[]): number {
  return targets.reduce((sum, target) => sum + Math.min(partial.stats[target.key as OptimizerStatKey], target.target), 0);
}

function optimizerMissingStats(stats: OptimizerStats, targets: LoadoutOptimizerTargetStat[]): LoadoutOptimizerStatValue[] {
  return targets
    .map((target) => {
      const value = stats[target.key as OptimizerStatKey] ?? 0;
      return {
        hash: target.hash,
        key: target.key,
        name: target.name,
        value,
        target: target.target,
        deficit: Math.max(0, target.target - value)
      };
    })
    .filter((entry) => (entry.deficit ?? 0) > 0);
}

function optimizerMissingTotal(missing: LoadoutOptimizerStatValue[]): number {
  return missing.reduce((sum, stat) => sum + (stat.deficit ?? 0), 0);
}

function optimizerWaste(stats: OptimizerStats, targets: LoadoutOptimizerTargetStat[]): number {
  return targets.reduce((sum, target) => sum + Math.max(0, stats[target.key as OptimizerStatKey] - target.target), 0);
}

function optimizerStatValues(stats: OptimizerStats, targets?: LoadoutOptimizerTargetStat[]): LoadoutOptimizerStatValue[] {
  const targetMap = new Map((targets ?? []).map((target) => [target.key, target.target]));
  return Object.entries(LOADOUT_OPTIMIZER_STAT_HASHES).map(([key, hash]) => {
    const value = stats[key as OptimizerStatKey] ?? 0;
    const target = targetMap.get(key);
    return {
      hash,
      key,
      name: LOADOUT_OPTIMIZER_STAT_LABELS[key],
      value,
      ...(target === undefined ? {} : { target, deficit: Math.max(0, target - value) })
    };
  });
}

function optimizerStatsFromArmorStats(stats: InventoryArmorStatSummary[]): OptimizerStats {
  const result = emptyOptimizerStats();
  for (const stat of stats) {
    const key = optimizerStatKeyFromHash(stat.hash);
    if (key) {
      result[key] += stat.value;
    }
  }
  return result;
}

function optimizerStatsFromPlugs(plugs: InventoryPlugSummary[]): OptimizerStats {
  return plugs.reduce((stats, plug) => addOptimizerStats(stats, optimizerStatsFromArmorStats(plug.statModifiers ?? [])), emptyOptimizerStats());
}

function optimizerStatKeyFromHash(hash: number): OptimizerStatKey | null {
  for (const [key, value] of Object.entries(LOADOUT_OPTIMIZER_STAT_HASHES)) {
    if (value === hash) return key as OptimizerStatKey;
  }
  return null;
}

function emptyOptimizerStats(): OptimizerStats {
  return {
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0
  };
}

function addOptimizerStats(left: OptimizerStats, right: OptimizerStats): OptimizerStats {
  const result = emptyOptimizerStats();
  for (const key of Object.keys(result) as OptimizerStatKey[]) {
    result[key] = (left[key] ?? 0) + (right[key] ?? 0);
  }
  return result;
}

function subtractOptimizerStats(left: OptimizerStats, right: OptimizerStats): OptimizerStats {
  const result = emptyOptimizerStats();
  for (const key of Object.keys(result) as OptimizerStatKey[]) {
    result[key] = Math.max(0, (left[key] ?? 0) - (right[key] ?? 0));
  }
  return result;
}

function normalizeOptimizerClassType(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^(0|titan|泰坦)$/iu.test(text)) return 0;
  if (/^(1|hunter|猎人)$/iu.test(text)) return 1;
  if (/^(2|warlock|术士)$/iu.test(text)) return 2;
  throw new BadRequestError("className must be 术士, 猎人, or 泰坦");
}

function selectOptimizerCharacter(characters: CharacterSummary[], classType: number): CharacterSummary | null {
  return (
    characters
      .filter((character) => character.classType === classType)
      .sort((left, right) => Date.parse(right.dateLastPlayed ?? "") - Date.parse(left.dateLastPlayed ?? ""))[0] ?? null
  );
}

function normalizeOptimizerTargets(input: Record<string, unknown> | undefined): LoadoutOptimizerTargetStat[] {
  const targets = Object.entries(input ?? {})
    .map(([key, value]): LoadoutOptimizerTargetStat | null => {
      const statKey = normalizeOptimizerStatKey(key);
      if (!statKey) return null;
      return {
        hash: LOADOUT_OPTIMIZER_STAT_HASHES[statKey],
        key: statKey,
        name: LOADOUT_OPTIMIZER_STAT_LABELS[statKey],
        target: clampIntegerValue(value, 100, 0, 200)
      };
    })
    .filter((target): target is LoadoutOptimizerTargetStat => target !== null && target.target > 0);
  if (targets.length === 0) {
    throw new BadRequestError("targetStats must include at least one Armor 3.0 stat target");
  }
  return targets;
}

function normalizeOptimizerStatKey(value: string): OptimizerStatKey | null {
  const text = value.trim().toLowerCase();
  if (/^(weapon|weapons|武器|mobility|mob|机动)$/iu.test(text)) return "mobility";
  if (/^(health|hp|生命|生命值|resilience|res|韧性)$/iu.test(text)) return "resilience";
  if (/^(class|classability|职业|职业技能|recovery|rec|恢复)$/iu.test(text)) return "recovery";
  if (/^(grenade|grenades|手雷|雷|discipline|dis|纪律)$/iu.test(text)) return "discipline";
  if (/^(super|超能|大招|intellect|int|智慧)$/iu.test(text)) return "intellect";
  if (/^(melee|近战|近戰|strength|str|力量)$/iu.test(text)) return "strength";
  return null;
}

function armorSlotOrder(slot: string): number {
  const index = ARMOR_SLOT_ORDER.indexOf(slot as never);
  return index === -1 ? 999 : index;
}

function optimizerSessionCacheKey(qq: string | undefined, sessionId: string): string {
  return `d2:loadout-optimizer:${qq ?? "unknown"}:${sessionId}`;
}

function clampIntegerValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return Math.min(max, Math.max(min, integer));
}

const CAREER_MODES: CareerModeInfo[] = [
  { mode: "all", label: "总计", icon: "hex", tone: "neutral" },
  { mode: "story", label: "剧情", bungieMode: 2, icon: "eye", tone: "gold" },
  { mode: "strike", label: "打击任务", bungieMode: 3, icon: "shield", tone: "blue" },
  { mode: "raid", label: "突袭", bungieMode: 4, icon: "star", tone: "purple" },
  { mode: "dungeon", label: "地牢", bungieMode: 82, icon: "gate", tone: "slate" },
  { mode: "patrol", label: "探索", bungieMode: 6, icon: "compass", tone: "gray" },
  { mode: "pvp", label: "熔炉", bungieMode: 5, icon: "cross", tone: "red" },
  { mode: "trials", label: "奥西里斯试炼", bungieMode: 84, icon: "eye", tone: "gold" },
  { mode: "iron_banner", label: "铁旗", bungieMode: 19, icon: "banner", tone: "green" },
  { mode: "quickplay", label: "快速游戏PVP", bungieMode: 70, icon: "cross", tone: "red" },
  { mode: "competitive", label: "竞技模式", bungieMode: 69, icon: "diamond", tone: "red" },
  { mode: "gambit", label: "智谋", bungieMode: 63, icon: "swirl", tone: "green" },
  { mode: "dares", label: "永恒挑战", bungieMode: 85, icon: "spark", tone: "teal" },
  { mode: "nightmare", label: "梦魇狩猎", bungieMode: 79, icon: "moon", tone: "dark" }
];

const CHARACTER_CAREER_MODES = CAREER_MODES.filter((mode) =>
  ["raid", "strike", "pvp", "trials", "dungeon", "gambit", "story", "patrol"].includes(mode.mode)
);

function emptyCareerModeSummary(
  membershipType: number,
  membershipId: string,
  mode: CareerModeInfo
): CareerModeSummary {
  return {
    membershipType,
    membershipId,
    mode: mode.mode,
    modeLabel: mode.label,
    icon: mode.icon,
    tone: mode.tone,
    stats: { ...EMPTY_HISTORICAL_SUMMARY },
    updatedAt: new Date().toISOString()
  };
}

function toCareerSeason(
  hashIdentifier: string,
  definition: SeasonDefinition,
  now: number
): NonNullable<CareerSummary["seasons"]>[number] | null {
  const name = asString(definition.displayProperties?.name);
  if (!name || /^Season$/iu.test(name)) {
    return null;
  }
  const startMs = dateMs(definition.startDate);
  const endMs = dateMs(definition.endDate);
  return {
    hashIdentifier,
    seasonNumber: optionalNumber(definition.seasonNumber),
    name,
    startDate: optionalString(definition.startDate),
    endDate: optionalString(definition.endDate),
    durationDays: startMs && endMs && endMs > startMs ? Math.round((endMs - startMs) / 86400000) : undefined,
    iconPath: optionalString(definition.displayProperties?.icon),
    backgroundImagePath: optionalString(definition.backgroundImagePath),
    active: Boolean(startMs && endMs && now >= startMs && now <= endMs),
    future: Boolean(startMs && now < startMs)
  };
}

function compareCareerSeasons(
  a: NonNullable<CareerSummary["seasons"]>[number],
  b: NonNullable<CareerSummary["seasons"]>[number]
): number {
  const aNumber = a.seasonNumber ?? 0;
  const bNumber = b.seasonNumber ?? 0;
  if (aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return (dateMs(a.startDate) ?? 0) - (dateMs(b.startDate) ?? 0);
}

function dateMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function normalizeSavedLoadoutName(value: string): string {
  const name = String(value || "").trim();
  if (!name) {
    throw new BadRequestError("name is required");
  }
  if (name.length > 80) {
    throw new BadRequestError("name must be 80 characters or fewer");
  }
  return name;
}

function selectSavedLoadoutCharacter(
  characters: CharacterSummary[],
  characterId?: string
): CharacterSummary | undefined {
  if (characterId) {
    return characters.find((character) => character.characterId === characterId);
  }
  return [...characters].sort((left, right) => {
    const rightTime = new Date(right.dateLastPlayed || 0).getTime();
    const leftTime = new Date(left.dateLastPlayed || 0).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0];
}

function savedInventoryItemSnapshot(item: InventoryItemSummary): InventoryItemSummary {
  return JSON.parse(JSON.stringify(item)) as InventoryItemSummary;
}

function optimizerArmorToInventorySnapshot(item: LoadoutOptimizerArmorItem): InventoryItemSummary {
  return {
    itemHash: item.itemHash,
    itemInstanceId: item.itemInstanceId,
    quantity: 1,
    owner: item.owner,
    ...(item.characterId ? { characterId: item.characterId } : {}),
    name: item.name,
    iconPath: item.iconPath,
    bucketName: item.slotLabel,
    itemTypeDisplayName: item.slotLabel,
    tierTypeName: item.tierTypeName,
    power: item.power,
    locked: false,
    canEquip: true,
    armorStats: {
      total: item.currentStats.reduce((sum, stat) => sum + Number(stat.value || 0), 0),
      stats: item.currentStats.map((stat) => ({
        hash: stat.hash,
        name: stat.name,
        value: stat.value
      }))
    }
  };
}

function savedLoadoutRowToSummary(row: SavedLoadoutRow): SavedLoadoutSummary {
  const items = (Array.isArray(row.items) ? row.items : [])
    .map((item) => asRecord(item))
    .map((item): InventoryItemSummary => ({
      itemHash: optionalNumber(item.itemHash) ?? 0,
      ...(optionalString(item.itemInstanceId) ? { itemInstanceId: optionalString(item.itemInstanceId) } : {}),
      quantity: optionalNumber(item.quantity) ?? 1,
      owner: normalizeInventoryOwner(optionalString(item.owner)),
      ...(optionalString(item.characterId) ? { characterId: optionalString(item.characterId) } : {}),
      ...(optionalNumber(item.bucketHash) !== undefined ? { bucketHash: optionalNumber(item.bucketHash) } : {}),
      bucketName: optionalString(item.bucketName),
      name: asString(item.name, "Unknown Item"),
      iconPath: optionalString(item.iconPath),
      itemTypeDisplayName: optionalString(item.itemTypeDisplayName),
      tierTypeName: optionalString(item.tierTypeName),
      ...(optionalNumber(item.power) !== undefined ? { power: optionalNumber(item.power) } : {}),
      locked: asBoolean(item.locked, false),
      canEquip: asBoolean(item.canEquip, true),
      transferStatus: optionalNumber(item.transferStatus),
      state: optionalNumber(item.state),
      classType: optionalNumber(item.classType),
      damageType: optionalString(item.damageType),
      energyCapacity: optionalNumber(item.energyCapacity),
      energyUsed: optionalNumber(item.energyUsed),
      sockets: Array.isArray(item.sockets) ? (item.sockets as InventorySocketSummary[]) : undefined,
      armorStats: isInventoryArmorStats(item.armorStats) ? (item.armorStats as InventoryArmorStatsSummary) : undefined,
      weaponStats: isInventoryWeaponStats(item.weaponStats) ? (item.weaponStats as InventoryItemSummary["weaponStats"]) : undefined
    }));
  return {
    id: row.id,
    qq: row.qq,
    name: row.name,
    className: row.className,
    characterId: row.characterId,
    source: row.source,
    itemCount: items.length,
    items,
    statMods: Array.isArray(row.statMods) ? (row.statMods as LoadoutOptimizerStatModSuggestion[]) : [],
    fragments: Array.isArray(row.fragments) ? (row.fragments as LoadoutOptimizerFragmentSuggestion[]) : [],
    notes: row.notes,
    lastAppliedAt: row.lastAppliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeInventoryOwner(value: string | undefined): InventoryOwner {
  if (value === "vault" || value === "inventory" || value === "equipped") {
    return value;
  }
  return "inventory";
}

function isInventoryArmorStats(value: unknown): value is InventoryArmorStatsSummary {
  const record = asRecord(value);
  return Array.isArray(record.stats);
}

function isInventoryWeaponStats(value: unknown): value is InventoryItemSummary["weaponStats"] {
  const record = asRecord(value);
  return Array.isArray(record.stats) || optionalNumber(record.rpm) !== undefined;
}

function isSavedLoadoutGearItem(item: InventoryItemSummary): boolean {
  if (optimizerArmorSlot(item) || optimizerItemLooksLikeSubclass(item)) {
    return true;
  }
  const text = `${item.bucketName ?? ""} ${item.itemTypeDisplayName ?? ""} ${item.name ?? ""}`.toLowerCase();
  return /kinetic|energy|power|武器|步枪|手炮|弓|榴弹|霰弹|狙击|机枪|火箭|融合|剑|手枪|追踪|刀剑|glaive|sidearm|rifle|cannon|bow|launcher|shotgun|sniper|machine|rocket|fusion|sword|smg|trace|grenade/iu.test(text);
}

const ACTIVITY_MODE_LABELS = new Map<number, string>([
  [5, "全部 PVP"],
  [10, "占领"],
  [12, "冲突"],
  [19, "铁旗"],
  [25, "狂欢"],
  [31, "霸权"],
  [37, "生存"],
  [38, "倒计时"],
  [39, "九之试炼"],
  [48, "混战"],
  [59, "决战"],
  [60, "封锁"],
  [61, "灼烧"],
  [65, "突破"],
  [69, "竞技"],
  [70, "快速比赛"],
  [71, "冲突"],
  [72, "竞技冲突"],
  [73, "占领"],
  [74, "竞技占领"],
  [80, "淘汰"],
  [81, "动量控制"],
  [84, "奥西里斯试炼"],
  [88, "裂隙"],
  [89, "区域控制"],
  [90, "铁旗裂隙"],
  [91, "铁旗区域控制"],
  [92, "圣物"],
  [93, "倒计时突袭"],
  [94, "将死"]
]);

function uniqueActivity<T extends { activityId: string }>(): (activity: T) => boolean {
  const seen = new Set<string>();
  return (activity) => {
    if (seen.has(activity.activityId)) {
      return false;
    }
    seen.add(activity.activityId);
    return true;
  };
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
