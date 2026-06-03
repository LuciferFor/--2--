import { BadRequestError } from "../lib/errors.js";

export type PublicMode = "all" | "raid" | "dungeon" | "trials" | "pvp" | "gambit";

export interface ModeInfo {
  publicMode: PublicMode;
  bungieMode?: number;
  bungieName?: string;
  label: string;
}

const MODES: Record<PublicMode, ModeInfo> = {
  all: {
    publicMode: "all",
    label: "全部"
  },
  raid: {
    publicMode: "raid",
    bungieMode: 4,
    bungieName: "Raid",
    label: "突袭"
  },
  dungeon: {
    publicMode: "dungeon",
    bungieMode: 82,
    bungieName: "Dungeon",
    label: "地牢"
  },
  trials: {
    publicMode: "trials",
    bungieMode: 84,
    bungieName: "TrialsOfOsiris",
    label: "试炼"
  },
  pvp: {
    publicMode: "pvp",
    bungieMode: 5,
    bungieName: "AllPvP",
    label: "熔炉"
  },
  gambit: {
    publicMode: "gambit",
    bungieMode: 63,
    bungieName: "Gambit",
    label: "智谋"
  }
};

export function parsePublicMode(value: unknown): ModeInfo {
  const mode = typeof value === "string" && value.length > 0 ? value : "all";
  if (mode in MODES) {
    return MODES[mode as PublicMode];
  }
  throw new BadRequestError("Unsupported mode", {
    supported: Object.keys(MODES)
  });
}

export function modeLabel(mode: PublicMode): string {
  return MODES[mode].label;
}
