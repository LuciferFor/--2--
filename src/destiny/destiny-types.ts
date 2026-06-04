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
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
  iconPath?: string;
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

export type InventoryOwner = "vault" | "inventory" | "equipped";
export type InventoryBucketFilter = "all" | "vault" | "inventory" | "equipped";

export interface InventoryItemSummary {
  itemHash: number;
  itemInstanceId?: string;
  quantity: number;
  owner: InventoryOwner;
  characterId?: string;
  bucketHash?: number;
  bucketName?: string;
  name: string;
  iconPath?: string;
  itemTypeDisplayName?: string;
  tierTypeName?: string;
  power?: number;
  locked: boolean;
  canEquip: boolean;
  transferStatus?: number;
  state?: number;
  classType?: number;
  damageType?: string;
  energyCapacity?: number;
  energyUsed?: number;
}

export interface InventorySummary {
  qq?: string;
  membershipType: number;
  membershipId: string;
  characters: CharacterSummary[];
  items: InventoryItemSummary[];
  totals: {
    items: number;
    vault: number;
    inventory: number;
    equipped: number;
  };
  updatedAt: string;
}

export interface InventorySearchSummary {
  qq?: string;
  membershipType: number;
  membershipId: string;
  query: string;
  bucket: InventoryBucketFilter;
  characterId?: string;
  items: InventoryItemSummary[];
  total: number;
  updatedAt: string;
}

export interface InventoryActionResult {
  qq?: string;
  membershipType: number;
  membershipId: string;
  action: "transfer" | "equip" | "equipItems" | "lock" | "equipLoadout";
  ok: boolean;
  itemId?: string;
  itemIds?: string[];
  itemHash?: number;
  characterId?: string;
  loadoutIndex?: number;
  bungieResponse: unknown;
  message: string;
  updatedAt: string;
}

export interface LoadoutSummary {
  index: number;
  characterId: string;
  name?: string;
  colorHash?: number;
  iconHash?: number;
  itemCount: number;
  raw?: unknown;
}

export interface LoadoutsSummary {
  qq?: string;
  membershipType: number;
  membershipId: string;
  characters: CharacterSummary[];
  loadouts: LoadoutSummary[];
  updatedAt: string;
}

export interface CraftableWeaponSummary {
  itemHash: string;
  name: string;
  iconPath?: string;
  itemTypeDisplayName?: string;
  tierTypeName?: string;
  watermarkIconPath?: string;
  groupName: string;
  visible: boolean;
  unlocked: boolean;
  failedRequirementIndexes: number[];
  requirementCount: number;
  socketCount: number;
}

export interface CraftableWeaponGroup {
  key: string;
  name: string;
  total: number;
  unlocked: number;
  locked: number;
  items: CraftableWeaponSummary[];
}

export interface CraftablesSummary {
  membershipType: number;
  membershipId: string;
  totals: {
    groups: number;
    weapons: number;
    unlocked: number;
    locked: number;
  };
  groups: CraftableWeaponGroup[];
  scan: {
    characterCount: number;
    rootNodeHash?: string;
    note: string;
  };
  updatedAt: string;
}

export type CatalystSlot = "kinetic" | "energy" | "power" | "unknown";

export interface CatalystObjectiveSummary {
  objectiveHash: string;
  progress: number;
  completionValue: number;
  complete: boolean;
  progressDescription?: string;
}

export interface CatalystWeaponSummary {
  recordHash: string;
  weaponHash?: string;
  name: string;
  description?: string;
  iconPath?: string;
  itemTypeDisplayName?: string;
  slot: CatalystSlot;
  slotLabel: string;
  completed: boolean;
  redeemed: boolean;
  visible: boolean;
  percent: number;
  progress: number;
  completionValue: number;
  objectives: CatalystObjectiveSummary[];
}

export interface CatalystWeaponGroup {
  key: CatalystSlot;
  name: string;
  total: number;
  completed: number;
  incomplete: number;
  items: CatalystWeaponSummary[];
}

export interface CatalystsSummary {
  membershipType: number;
  membershipId: string;
  totals: {
    groups: number;
    catalysts: number;
    completed: number;
    incomplete: number;
    visible: number;
  };
  groups: CatalystWeaponGroup[];
  scan: {
    recordDefinitions: number;
    candidateRecords: number;
    recordsReturned: number;
    collectiblesReturned: number;
    catalystPresentationRecords: number;
    note: string;
  };
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

export interface DungeonOverviewActivity {
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
  sortOrder: number;
}

export interface DungeonOverview {
  membershipType: number;
  membershipId: string;
  mode: "dungeon";
  modeLabel: string;
  totals: {
    activities: number;
    dungeons: number;
    clears: number;
    fullClears: number;
    completions: number;
    sherpaCompletions: number;
    kills: number;
    deaths: number;
    secondsPlayed: number;
    fastestCompletionMs?: number;
    fastestCompletionDisplay?: string;
  };
  activities: DungeonOverviewActivity[];
  dungeons: DungeonOverviewActivity[];
  scan: {
    historyPages: number;
    pgcrLimit: number;
    recentActivitiesScanned: number;
    pgcrScanned: number;
    note: string;
  };
  updatedAt: string;
}

export type GrandmasterSeasonScope = "current" | "all";

export interface GrandmasterStrikeSummary {
  name: string;
  activityHashes: number[];
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
  averageCompletionSeconds?: number;
  completionRate: number;
  lastClearedAt?: string;
  lastActivityId?: string;
}

export interface GrandmasterRecentPlayer {
  displayName: string;
  membershipId?: string;
  emblemPath?: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  completed: boolean;
  weapons: WeaponUsageSummary[];
}

export interface GrandmasterRecentActivity {
  activityId: string;
  referenceId?: number;
  activityName: string;
  pgcrImage?: string;
  period?: string;
  completed: boolean;
  durationSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
  players: GrandmasterRecentPlayer[];
}

export interface GrandmasterOverview {
  membershipType: number;
  membershipId: string;
  season: {
    scope: GrandmasterSeasonScope;
    currentSeasonName?: string;
    currentSeasonStart?: string;
    currentSeasonEnd?: string;
    currentSeasonReliable: boolean;
  };
  totals: {
    strikes: number;
    currentSeasonClears: number;
    lifetimeClears: number;
    attempts: number;
    completions: number;
    kills: number;
    deaths: number;
    secondsPlayed: number;
    fastestCompletionMs?: number;
    fastestCompletionDisplay?: string;
    averageCompletionSeconds?: number;
  };
  strikes: GrandmasterStrikeSummary[];
  recent: GrandmasterRecentActivity[];
  scan: {
    historyPages: number;
    pgcrLimit: number;
    season: GrandmasterSeasonScope;
    recentActivitiesScanned: number;
    pgcrScanned: number;
    currentSeasonReliable: boolean;
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

export type HeatmapRange = "all" | "year" | "recent";

export interface HeatmapCalendarDay extends HeatmapBucket {
  date: string;
  day: number;
  weekday: number;
  week: number;
  intensity: number;
}

export interface HeatmapCalendarMonth {
  key: string;
  year: number;
  month: number;
  label: string;
  firstWeekday: number;
  daysInMonth: number;
  totals: HeatmapBucket;
  days: HeatmapCalendarDay[];
}

export interface HeatmapCalendarYear {
  year: number;
  totals: HeatmapBucket;
  months: HeatmapCalendarMonth[];
}

export interface HeatmapSummary {
  membershipType: number;
  membershipId: string;
  mode: PublicMode;
  modeLabel: string;
  timezone: string;
  range: HeatmapRange;
  year?: number;
  activitiesScanned: number;
  days: HeatmapBucket[];
  hours: HeatmapBucket[];
  calendar: HeatmapCalendarYear[];
  scan: {
    range: HeatmapRange;
    pagesPerCharacter: number;
    maxPagesPerCharacter: number;
    truncated: boolean;
    partial?: boolean;
    errors?: string[];
    note: string;
  };
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
