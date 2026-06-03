import type { CacheStore } from "../cache/cache.js";
import type { Store } from "../db/store.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { asArray, asNumber, asRecord, asString, numberFrom, optionalNumber, optionalString } from "../lib/json.js";
import { CACHE_TTL, PROFILE_COMPONENTS } from "./constants.js";
import { parseBungieName } from "./bungie-name.js";
import type { BungieClient } from "./bungie-client.js";
import type {
  AccountSummary,
  ActivitySummary,
  CharacterSummary,
  PgcrPlayerSummary,
  PgcrSummary,
  PlayerSearchResult,
  ProfileSummary,
  WeaponUsageSummary,
  WeaponsSummary
} from "./destiny-types.js";
import type { ManifestService } from "./manifest-service.js";
import { parsePublicMode, type ModeInfo } from "./modes.js";
import { aggregatePgcrPlayerValues, statBasicValue, summarizeHistoricalStats } from "./stat-utils.js";

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

    const response = await this.client.get<unknown>(
      `/Destiny2/${membershipType}/Account/${membershipId}/Character/0/Stats/`,
      {
        query: {
          periodType: "AllTime",
          groups: "General",
          ...(mode.bungieMode === undefined ? {} : { modes: mode.bungieMode })
        }
      }
    );

    const result: AccountSummary = {
      membershipType,
      membershipId,
      mode: mode.publicMode,
      modeLabel: mode.label,
      stats: summarizeHistoricalStats(response),
      updatedAt: new Date().toISOString()
    };

    await this.cache.setJson(cacheKey, result, CACHE_TTL.summary);
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
    const values = aggregatePgcrPlayerValues(entry.values);
    const extended = asRecord(entry.extended);
    const weapons = await Promise.all(
      asArray(extended.weapons).map((weapon) => this.toWeaponUsage(asRecord(weapon)))
    );

    return {
      displayName:
        asString(destinyUserInfo.bungieGlobalDisplayName) ||
        asString(destinyUserInfo.displayName) ||
        asString(player.displayName, "Unknown"),
      membershipType: optionalNumber(destinyUserInfo.membershipType),
      membershipId: optionalString(destinyUserInfo.membershipId),
      characterId: optionalString(entry.characterId),
      emblemPath: optionalString(player.emblemPath),
      team: optionalNumber(entry.team),
      standing: optionalNumber(entry.standing),
      ...values,
      weapons: weapons.sort((a, b) => b.kills - a.kills)
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
    return this.manifest.getDisplayName("DestinyActivityModeDefinition", modeNumber, `Mode ${modeNumber}`);
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
}
