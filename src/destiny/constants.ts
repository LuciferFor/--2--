export const BUNGIE_ROOT = "https://www.bungie.net";

export const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 4, 5, 6, 10, 20, 254]);

export const PROFILE_COMPONENTS = ["Profiles", "Characters"] as const;
export const CRAFTABLES_COMPONENTS = ["Profiles", "Characters", "Craftables"] as const;
export const CATALYST_COMPONENTS = ["Profiles", "Characters", "Records", "Collectibles"] as const;
export const PRIVATE_INVENTORY_COMPONENTS = [
  100, // Profiles
  102, // ProfileInventories
  200, // Characters
  201, // CharacterInventories
  205, // CharacterEquipment
  206, // CharacterLoadouts
  300, // ItemInstances
  307 // ItemCommonData
] as const;

export const CACHE_TTL = {
  playerSearch: 24 * 60 * 60,
  profile: 10 * 60,
  summary: 30 * 60,
  activities: 5 * 60,
  pgcr: 30 * 24 * 60 * 60,
  career: 30 * 60,
  activityOverview: 30 * 60,
  heatmap: 30 * 60,
  heatmapLong: 24 * 60 * 60,
  raidOverview: 30 * 60,
  dungeonOverview: 30 * 60,
  grandmasterOverview: 30 * 60,
  weapons: 30 * 60,
  craftables: 30 * 60,
  catalysts: 30 * 60,
  manifestDefinition: 30 * 24 * 60 * 60
} as const;

export const COMMON_MANIFEST_ENTITY_TYPES = [
  "DestinyActivityDefinition",
  "DestinyActivityModeDefinition",
  "DestinyClassDefinition",
  "DestinyDestinationDefinition",
  "DestinyInventoryItemDefinition",
  "DestinyInventoryBucketDefinition",
  "DestinyPlaceDefinition",
  "DestinyPresentationNodeDefinition",
  "DestinyRecordDefinition"
] as const;
