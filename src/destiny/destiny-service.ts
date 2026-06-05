import type { CacheStore } from "../cache/cache.js";
import type { Store } from "../db/store.js";
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
  CatalystSlot,
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
  InventoryArmorStatsSummary,
  InventoryActionResult,
  InventoryBucketFilter,
  InventoryItemSummary,
  InventoryOwner,
  InventoryPlugSummary,
  InventorySearchSummary,
  InventorySocketSummary,
  InventorySummary,
  LoadoutsSummary,
  NamecardSummary,
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
const NIGHTFALL_MODE_TYPE = 16;
const RAID_HISTORY_PAGE_SIZE = 250;
const HEATMAP_FULL_HISTORY_MAX_PAGES = 100;
const KINETIC_BUCKET_HASHES = new Set([1498876634]);
const ENERGY_BUCKET_HASHES = new Set([2465295065]);
const POWER_BUCKET_HASHES = new Set([953998645]);
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
  2996146975: "机动",
  392767087: "韧性",
  1943323491: "恢复",
  1735777505: "纪律",
  144602215: "智慧",
  4244567218: "力量"
};

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
    const aggregateResponses = await Promise.all(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );

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
    const cacheKey = `d2:grandmasters:${membershipType}:${membershipId}:${options.historyPages}:${options.pgcrLimit}:${options.season}`;
    const cached = await this.cache.getJson<GrandmasterOverview>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const activityDefinitions = await this.manifest.getDefinitionMap<RaidActivityDefinition>(
      "DestinyActivityDefinition"
    );
    const activeSeason = await this.getActiveSeasonWindow();
    const aggregateResponses = await Promise.all(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );

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
        if (!group.lastClearedAt || activity.period > group.lastClearedAt) {
          group.lastClearedAt = activity.period;
          group.lastActivityId = activity.activityId;
        }
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
    const cacheKey = `d2:pgcr:${activityId}`;
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
    const cacheKey = `d2:catalysts:${membershipType}:${membershipId}`;
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
    }
  ): Promise<InventorySearchSummary> {
    const inventory = await this.getPrivateInventory(membershipType, membershipId, accessToken, options.qq);
    const searchQueries = inventorySearchCandidates(options.query);
    const characterId = options.characterId;
    const items = inventory.items.filter((item) => {
      if (options.bucket !== "all" && item.owner !== options.bucket) {
        return false;
      }
      if (characterId && item.characterId !== characterId) {
        return false;
      }
      if (searchQueries.length === 0) {
        return true;
      }
      const itemText = normalizeSearchText(`${item.name} ${item.itemTypeDisplayName ?? ""} ${item.bucketName ?? ""}`);
      return searchQueries.some((query) => itemText.includes(query));
    });

    return {
      qq: options.qq,
      membershipType,
      membershipId,
      query: options.query?.trim() ?? "",
      bucket: options.bucket,
      ...(characterId ? { characterId } : {}),
      items,
      total: items.length,
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
    const aggregateResponses = await Promise.all(
      profile.characters.map((character) =>
        this.client.get<unknown>(
          `/Destiny2/${membershipType}/Account/${membershipId}/Character/${character.characterId}/Stats/AggregateActivityStats/`
        )
      )
    );

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
      .filter((raid) => raid.clears > 0 || raid.completions > 0)
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
        recentActivitiesScanned: recentActivities.length,
        pgcrScanned,
        note: "fullClears/completions/fastest are all-time aggregate stats; sherpa/flawless/dayOne/solo/trio are only confirmed from scanned recent PGCRs"
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
      emblemPath: optionalString(player.emblemPath),
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
      ...inventorySocketsForItem(definition, socketComponent, reusablePlugComponent, inventoryDefinitions),
      ...inventoryArmorStatsForItem(definition, statComponent, statDefinitions)
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
    const objectives = toCatalystObjectives(component, definition);
    const progress = objectives.reduce((sum, objective) => sum + objective.progress, 0);
    const completionValue = objectives.reduce((sum, objective) => sum + objective.completionValue, 0);
    const redeemed = hasRecordState(asRecord(component).state, 1);
    const visible = !hasRecordState(asRecord(component).state, 8) && !hasRecordState(asRecord(component).state, 16);
    const completed = redeemed || (objectives.length > 0 && objectives.every((objective) => objective.complete));
    const percent = completionValue > 0 ? round((Math.min(progress, completionValue) / completionValue) * 100) : completed ? 100 : 0;
    const slot = catalystSlotFromItem(weaponDefinition);
    const fallbackName = stripCatalystWords(recordName) || recordName;
    return {
      recordHash,
      weaponHash,
      name: asString(weaponDefinition?.displayProperties?.name, fallbackName),
      description: optionalString(definition.displayProperties?.description),
      iconPath: optionalString(weaponDefinition?.displayProperties?.icon) ?? optionalString(definition.displayProperties?.icon),
      itemTypeDisplayName: optionalString(weaponDefinition?.itemTypeDisplayName),
      slot,
      slotLabel: CATALYST_SLOT_LABELS[slot],
      completed,
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
        const pages = await Promise.all(
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
        return pages.flat();
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
          mode: NIGHTFALL_MODE_TYPE
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
  const raw =
    optionalString(definition?.displayProperties?.name) ??
    optionalString(definition?.selectionScreenDisplayProperties?.name) ??
    fallback;
  return raw
    .replace(/\s*[:：]\s*(Grandmaster|宗师)\s*$/iu, "")
    .replace(/\s*[（(]\s*(Grandmaster|宗师)\s*[）)]\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
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

function normalizeCatalystMatchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s'’"“”《》:：·\-|/\\()[\]{}]+/gu, "")
    .trim();
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

  const fallbackHash = rewardHashes.find((hash) => inventoryDefinitions[hash]);
  const cleanName = normalizeCatalystMatchName(stripCatalystWords(recordName));
  if (cleanName.length >= 2) {
    for (const [hash, item] of Object.entries(inventoryDefinitions)) {
      const itemName = normalizeCatalystMatchName(asString(item.displayProperties?.name));
      if (itemName === cleanName && isLikelyWeaponItem(item)) {
        return hash;
      }
    }
  }

  return fallbackHash;
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
  const aliases: Array<[RegExp, string]> = [
    [/^(微冲|微冲枪|smg|submachinegun|submachine)$/iu, "冲锋枪"],
    [/(冲锋枪|微型冲锋枪)/u, "冲锋枪"],
    [/^(喷子|霰弹|shotgun)$/iu, "霰弹枪"],
    [/(霰弹枪)/u, "霰弹枪"],
    [/^(筒子|火箭|火箭筒|rocket|rocketlauncher)$/iu, "火箭发射器"],
    [/(火箭发射器)/u, "火箭发射器"],
    [/^(榴弹|榴弹发射器|gl|grenadelauncher)$/iu, "榴弹发射器"],
    [/^(手炮|hc|handcannon)$/iu, "手炮"],
    [/^(脉冲|脉冲步枪|pulse|pulserifle)$/iu, "脉冲步枪"],
    [/^(斥候|斥候步枪|scout|scoutrifle)$/iu, "斥候步枪"],
    [/^(自动|自动步枪|ar|autorifle)$/iu, "自动步枪"],
    [/^(狙|狙击|狙击枪|sniper|sniperrifle)$/iu, "狙击步枪"],
    [/^(融合|融合枪|fusion|fusionrifle)$/iu, "融合步枪"],
    [/^(线融|线性融合|线性融合步枪|linear|linearfusion)$/iu, "线性融合步枪"],
    [/^(机枪|mg|machinegun)$/iu, "机枪"],
    [/^(刀剑|剑|sword)$/iu, "剑"],
    [/^(弓|bow)$/iu, "弓"],
    [/^(手枪|sidearm)$/iu, "手枪"]
  ];
  return aliases.filter(([pattern]) => pattern.test(compact)).map(([, canonical]) => canonical);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeSearchText(value)).filter(Boolean))];
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
  inventoryDefinitions: Record<string, InventoryItemDefinition>
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
        ? toInventoryPlugSummary(selectedPlugHash, inventoryDefinitions, {
            selected: true,
            enabled: asBoolean(socket.isEnabled, true)
          })
        : undefined;
      const reusablePlugs = reusablePlugsForSocket(reusableBySocket, index, selectedPlugHash, inventoryDefinitions);
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
  inventoryDefinitions: Record<string, InventoryItemDefinition>
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
      toInventoryPlugSummary(itemHash, inventoryDefinitions, {
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
  options: { selected: boolean; enabled?: boolean }
): InventoryPlugSummary {
  const definition = inventoryDefinitions[String(itemHash)];
  return {
    itemHash,
    name: asString(definition?.displayProperties?.name, `Plug ${itemHash}`),
    iconPath: optionalString(definition?.displayProperties?.icon),
    description: optionalString(definition?.displayProperties?.description),
    selected: options.selected,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {})
  };
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
      name:
        optionalString(statDefinition?.displayProperties?.name) ??
        ARMOR_STAT_FALLBACK_NAMES[hash] ??
        String(hash),
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

function inventoryDefinitionLooksLikeArmor(definition: InventoryItemDefinition | undefined): boolean {
  const text = `${asString(definition?.itemTypeDisplayName)} ${asString(definition?.inventory?.bucketTypeName)}`.toLowerCase();
  return /armor|helmet|gauntlet|chest|leg|class item|头盔|臂铠|手套|胸甲|腿甲|护腿|职业物品|护甲/u.test(text);
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
