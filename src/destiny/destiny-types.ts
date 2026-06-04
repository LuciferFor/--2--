import type { HistoricalStatsSummary } from "./stat-utils.js";
import type { PublicMode } from "./modes.js";

export interface PlayerSearchResult {
  bungieName: string;
  displayName: string;
  displayNameCode: number;
  membershipType: number;
  membershipId: string;
  iconPath?: string;
}

export interface CharacterSummary {
  characterId: string;
  classType: number;
  className: string;
  light: number;
  emblemPath?: string;
  emblemBackgroundPath?: string;
  dateLastPlayed?: string;
  minutesPlayedTotal: number;
}

export interface ProfileSummary {
  membershipType: number;
  membershipId: string;
  profile: {
    dateLastPlayed?: string;
    minutesPlayedTotal: number;
    characterIds: string[];
  };
  characters: CharacterSummary[];
}

export interface AccountSummary {
  membershipType: number;
  membershipId: string;
  mode: string;
  modeLabel: string;
  stats: HistoricalStatsSummary;
  updatedAt: string;
}

export interface ActivitySummary {
  period: string;
  activityId: string;
  referenceId?: number;
  activityName: string;
  mode?: number;
  modeName?: string;
  characterId?: string;
  values: Record<string, unknown>;
}

export interface PgcrPlayerSummary {
  displayName: string;
  membershipType?: number;
  membershipId?: string;
  characterId?: string;
  emblemPath?: string;
  team?: number;
  standing?: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kda: number;
  efficiency: number;
  completed: boolean;
  score: number;
  weapons: WeaponUsageSummary[];
}

export interface PgcrSummary {
  activityId: string;
  period?: string;
  activityName: string;
  mode?: number;
  modeName?: string;
  players: PgcrPlayerSummary[];
  teams: unknown[];
}

export interface WeaponUsageSummary {
  referenceId: string;
  name: string;
  iconPath?: string;
  kills: number;
  precisionKills: number;
  secondsUsed: number;
}

export interface WeaponsSummary {
  membershipType: number;
  membershipId: string;
  weapons: WeaponUsageSummary[];
  updatedAt: string;
}

export interface CareerSummary {
  membershipType: number;
  membershipId: string;
  modes: CareerModeSummary[];
  profile?: ProfileSummary;
  seasons?: CareerSeasonSummary[];
  characters?: CareerCharacterSummary[];
  updatedAt: string;
}

export interface CareerModeSummary extends AccountSummary {
  icon?: string;
  tone?: string;
}

export interface CareerSeasonSummary {
  hashIdentifier: string;
  seasonNumber?: number;
  name: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  iconPath?: string;
  backgroundImagePath?: string;
  active: boolean;
  future: boolean;
}

export interface CareerCharacterSummary extends CharacterSummary {
  totalSecondsPlayed: number;
  modeSummaries: CareerModeSummary[];
}

export interface PvpOverview {
  membershipType: number;
  membershipId: string;
  summary: AccountSummary;
  trials: AccountSummary;
  recent: ActivitySummary[];
  aggregates: PvpAggregateStats;
  kdComparison: PvpKdComparisonPoint[];
  recentWeapons: PvpRecentWeaponSummary[];
  modeBreakdown: PvpModeBreakdown[];
  matches: PvpMatchSummary[];
  weapons: WeaponUsageSummary[];
  weaponScope: string;
  updatedAt: string;
}

export interface PvpAggregateStats {
  matchesScanned: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kda: number;
  winRate: number;
  bestKills: number;
  bestKd: number;
  flawlessMatches: number;
}

export interface PvpKdComparisonPoint {
  activityId: string;
  activityName: string;
  period?: string;
  result: "win" | "loss" | "unknown";
  playerKd: number;
  teamKd: number;
  opponentKd: number;
}

export interface PvpRecentWeaponSummary extends WeaponUsageSummary {
  matchesUsed: number;
}

export interface PvpModeBreakdown {
  modeName: string;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  winRate: number;
}

export interface PvpMatchWeaponSummary extends WeaponUsageSummary {
  precisionRate: number;
}

export interface PvpMatchSummary {
  activityId: string;
  period?: string;
  activityName: string;
  modeName?: string;
  result: "win" | "loss" | "unknown";
  score?: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kda: number;
  completed: boolean;
  teamKd: number;
  opponentKd: number;
  weapons: PvpMatchWeaponSummary[];
}

export interface ActivityModeOverviewActivity {
  name: string;
  activityHashes: number[];
  pgcrImage?: string;
  clears: number;
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

export interface ActivityModeOverview {
  membershipType: number;
  membershipId: string;
  mode: PublicMode;
  modeLabel: string;
  totals: {
    activities: number;
    clears: number;
    kills: number;
    deaths: number;
    secondsPlayed: number;
  };
  activities: ActivityModeOverviewActivity[];
  scan: {
    historyPages: number;
    recentActivitiesScanned: number;
    note: string;
  };
  updatedAt: string;
}

export interface HeatmapBucket {
  key: string;
  activities: number;
  completed: number;
  kills: number;
  deaths: number;
  secondsPlayed: number;
}

export interface HeatmapSummary {
  membershipType: number;
  membershipId: string;
  mode: PublicMode;
  modeLabel: string;
  timezone: string;
  activitiesScanned: number;
  days: HeatmapBucket[];
  hours: HeatmapBucket[];
  updatedAt: string;
}

export interface NamecardSummary {
  membershipType: number;
  membershipId: string;
  profile: ProfileSummary;
  summary: AccountSummary;
  updatedAt: string;
}

export interface RaidOverviewFlawlessStatus {
  status: "confirmed" | "not_found_in_scanned_pgcr" | "unknown";
  personal: boolean;
  fireteam: boolean;
  activityId?: string;
  period?: string;
}

export interface RaidOverviewDayOneStatus {
  status: "confirmed" | "not_found_in_scanned_pgcr" | "unknown";
  releaseAt?: string;
  windowHours?: number;
  activityId?: string;
  period?: string;
}

export interface RaidOverviewActivity {
  name: string;
  displayName?: string;
  difficulty: string;
  difficultyLabel: string;
  activityHashes: number[];
  pgcrImage?: string;
  clears: number;
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
  tags: string[];
  flawless: RaidOverviewFlawlessStatus;
  dayOne: RaidOverviewDayOneStatus;
  releaseAt?: string;
  sortOrder: number;
}

export interface RaidOverview {
  membershipType: number;
  membershipId: string;
  totals: {
    raids: number;
    clears: number;
    completions: number;
    sherpaCompletions: number;
    kills: number;
    deaths: number;
    secondsPlayed: number;
  };
  raids: RaidOverviewActivity[];
  scan: {
    historyPages: number;
    pgcrLimit: number;
    recentActivitiesScanned: number;
    pgcrScanned: number;
    note: string;
  };
  updatedAt: string;
}
