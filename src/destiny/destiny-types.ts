import type { HistoricalStatsSummary } from "./stat-utils.js";

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
  flawless: RaidOverviewFlawlessStatus;
  dayOne: RaidOverviewDayOneStatus;
}

export interface RaidOverview {
  membershipType: number;
  membershipId: string;
  totals: {
    raids: number;
    clears: number;
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
