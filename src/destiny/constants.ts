export const BUNGIE_ROOT = "https://www.bungie.net";

export const VALID_MEMBERSHIP_TYPES = new Set([1, 2, 3, 4, 5, 6, 10, 20, 254]);

export const PROFILE_COMPONENTS = ["Profiles", "Characters"] as const;

export const CACHE_TTL = {
  playerSearch: 24 * 60 * 60,
  profile: 10 * 60,
  summary: 30 * 60,
  activities: 5 * 60,
  pgcr: 30 * 24 * 60 * 60,
  weapons: 30 * 60,
  manifestDefinition: 30 * 24 * 60 * 60
} as const;

export const COMMON_MANIFEST_ENTITY_TYPES = [
  "DestinyActivityDefinition",
  "DestinyActivityModeDefinition",
  "DestinyClassDefinition",
  "DestinyDestinationDefinition",
  "DestinyInventoryItemDefinition",
  "DestinyPlaceDefinition"
] as const;
