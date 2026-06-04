import type { CacheStore } from "../cache/cache.js";
import type { Store } from "../db/store.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { asArray, asNumber, asRecord, asString, numberFrom, optionalNumber, optionalString } from "../lib/json.js";
import { CACHE_TTL, PROFILE_COMPONENTS } from "./constants.js";
import { parseBungieName } from "./bungie-name.js";
import type { BungieClient } from "./bungie-client.js";
import type {
  AccountSummary,
  ActivityModeOverview,
  ActivityModeOverviewActivity,
  ActivitySummary,
  CareerModeSummary,
  CareerSummary,
  CharacterSummary,
  HeatmapBucket,
  HeatmapSummary,
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
const RAID_HISTORY_PAGE_SIZE = 250;

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
    const charactersData = asRecord(asRecord(profileResponse.characters).data);
    const characterIds = asArray(profileData.characterIds).map(String);

    const characters = await Promise.all(
      Object.entries(charactersData).map(([characterId, value]) =>
        this.toCharacterSummary(characterId, asRecord(value))
      )
    );

    const result: ProfileSummary = {
      membershipType,
      membershipId,
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
    options: { historyPages: number }
  ): Promise<ActivityModeOverview> {
    return this.getActivityModeOverview(membershipType, membershipId, "dungeon", options);
  }

  async getHeatmap(
    membershipType: number,
    membershipId: string,
    modeValue: unknown,
    options: { pages: number; timezone: string }
  ): Promise<HeatmapSummary> {
    const mode = parsePublicMode(modeValue);
    const cacheKey = `d2:heatmap:${membershipType}:${membershipId}:${mode.publicMode}:${options.pages}:${options.timezone}`;
    const cached = await this.cache.getJson<HeatmapSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.getProfile(membershipType, membershipId);
    const perCharacter = await Promise.all(
      profile.characters.map(async (character) => {
        const pages = await Promise.all(
          Array.from({ length: options.pages }, (_, page) =>
            this.getCharacterActivities(membershipType, membershipId, character.characterId, mode, RAID_HISTORY_PAGE_SIZE, page)
          )
        );
        return pages.flat();
      })
    );
    const activities = perCharacter
      .flat()
      .filter(uniqueActivity())
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

    const result: HeatmapSummary = {
      membershipType,
      membershipId,
      mode: mode.publicMode,
      modeLabel: mode.label,
      timezone: options.timezone,
      activitiesScanned: activities.length,
      days: [...dayBuckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
      hours: [...hourBuckets.values()].sort((a, b) => Number(a.key) - Number(b.key)),
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.heatmap);
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
      .sort((a, b) => b.clears - a.clears || a.name.localeCompare(b.name));

    const result: RaidOverview = {
      membershipType,
      membershipId,
      totals: {
        raids: raids.length,
        clears: raids.reduce((sum, raid) => sum + raid.clears, 0),
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
        note: "clears/fastest are all-time aggregate stats; flawless/dayOne are only confirmed from scanned recent PGCRs"
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

    const name = normalizeRaidDisplayName(asString(definition.displayProperties?.name, `Raid ${activityHash}`));
    if (isPantheonActivityName(name)) {
      return;
    }
    const group = getOrCreateRaidGroup(groups, name, definition);
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
      const name = normalizeRaidDisplayName(asString(definition?.displayProperties?.name, activity.activityName));
      return definition && isRaidActivityDefinition(definition) && !isPantheonActivityName(name);
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

  private groupForActivity(
    groups: Map<string, RaidOverviewGroup>,
    referenceId: number | undefined,
    fallbackName: string,
    activityDefinitions: Record<string, RaidActivityDefinition>
  ): RaidOverviewGroup | null {
    const definition = referenceId === undefined ? undefined : activityDefinitions[String(referenceId)];
    const name = normalizeRaidDisplayName(asString(definition?.displayProperties?.name, fallbackName));
    if (isPantheonActivityName(name)) {
      return null;
    }
    return groups.get(name) ?? (definition && isRaidActivityDefinition(definition) ? getOrCreateRaidGroup(groups, name, definition) : null);
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

  private applyRaidPgcrScan(group: RaidOverviewGroup, pgcr: PgcrSummary, membershipId: string): void {
    const playerEntries = pgcr.players.filter((player) => player.membershipId === membershipId);
    const playerCompleted = playerEntries.some((player) => player.completed);
    if (!playerCompleted) {
      return;
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
}

interface RaidActivityDefinition {
  displayProperties?: {
    name?: string;
    icon?: string;
  };
  activityModeTypes?: number[];
  pgcrImage?: string;
  [key: string]: unknown;
}

interface RaidOverviewGroup {
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
  flawless: RaidOverviewActivity["flawless"];
  dayOne: RaidOverviewActivity["dayOne"];
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

function isRaidActivityDefinition(definition: RaidActivityDefinition): boolean {
  return Array.isArray(definition.activityModeTypes) && definition.activityModeTypes.includes(RAID_MODE_TYPE);
}

function isActivityDefinitionForMode(definition: RaidActivityDefinition, modeType: number): boolean {
  return Array.isArray(definition.activityModeTypes) && definition.activityModeTypes.includes(modeType);
}

function getOrCreateRaidGroup(
  groups: Map<string, RaidOverviewGroup>,
  name: string,
  definition: RaidActivityDefinition
): RaidOverviewGroup {
  const existing = groups.get(name);
  if (existing) {
    existing.pgcrImage ??= definition.pgcrImage;
    return existing;
  }

  const releaseWindow = findRaidReleaseWindow(name);
  const group: RaidOverviewGroup = {
    name,
    activityHashes: new Set(),
    pgcrImage: definition.pgcrImage,
    completions: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    secondsPlayed: 0,
    flawless: {
      status: "unknown",
      personal: false,
      fireteam: false
    },
    dayOne: {
      status: "unknown",
      releaseAt: releaseWindow?.releaseAt,
      windowHours: releaseWindow?.windowHours
    }
  };
  groups.set(name, group);
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

function normalizeRaidDisplayName(name: string): string {
  return name
    .replace(/\s*[:：]\s*(Normal|Master|Legend|Contest|Epic|Standard|标准|大师|普通|传说|竞赛|史诗)\s*$/iu, "")
    .replace(/\s*[（(]\s*(Normal|Master|Legend|Contest|Epic|Standard|标准|大师|普通|传说|竞赛|史诗)\s*[）)]\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeActivityDisplayName(name: string): string {
  return normalizeRaidDisplayName(name);
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
    lastActivityId: group.lastActivityId,
    flawless: group.flawless,
    dayOne: group.dayOne
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
