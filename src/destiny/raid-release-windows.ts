export interface RaidReleaseWindow {
  name: string;
  aliases: string[];
  releaseAt: string;
  windowHours: number;
}

export const RAID_RELEASE_WINDOWS: RaidReleaseWindow[] = [
  { name: "Leviathan", aliases: ["Leviathan", "利维坦"], releaseAt: "2017-09-13T17:00:00.000Z", windowHours: 24 },
  { name: "Eater of Worlds", aliases: ["Eater of Worlds", "世界吞噬者"], releaseAt: "2017-12-08T17:00:00.000Z", windowHours: 24 },
  { name: "Spire of Stars", aliases: ["Spire of Stars", "星之塔"], releaseAt: "2018-05-11T17:00:00.000Z", windowHours: 24 },
  { name: "Last Wish", aliases: ["Last Wish", "最后一愿"], releaseAt: "2018-09-14T17:00:00.000Z", windowHours: 24 },
  { name: "Scourge of the Past", aliases: ["Scourge of the Past", "往日之苦"], releaseAt: "2018-12-07T17:00:00.000Z", windowHours: 24 },
  { name: "Crown of Sorrow", aliases: ["Crown of Sorrow", "悲伤王冠"], releaseAt: "2019-06-04T23:00:00.000Z", windowHours: 24 },
  { name: "Garden of Salvation", aliases: ["Garden of Salvation", "救赎花园"], releaseAt: "2019-10-05T17:00:00.000Z", windowHours: 24 },
  { name: "Deep Stone Crypt", aliases: ["Deep Stone Crypt", "深岩墓室"], releaseAt: "2020-11-21T18:00:00.000Z", windowHours: 24 },
  { name: "Vault of Glass", aliases: ["Vault of Glass", "玻璃拱顶"], releaseAt: "2021-05-22T17:00:00.000Z", windowHours: 24 },
  { name: "Vow of the Disciple", aliases: ["Vow of the Disciple", "门徒誓约"], releaseAt: "2022-03-05T18:00:00.000Z", windowHours: 48 },
  { name: "King's Fall", aliases: ["King's Fall", "Kings Fall", "国王的陨落"], releaseAt: "2022-08-26T17:00:00.000Z", windowHours: 24 },
  { name: "Root of Nightmares", aliases: ["Root of Nightmares", "梦魇根源"], releaseAt: "2023-03-10T17:00:00.000Z", windowHours: 48 },
  { name: "Crota's End", aliases: ["Crota's End", "Crotas End", "克洛塔的末日"], releaseAt: "2023-09-01T17:00:00.000Z", windowHours: 48 },
  { name: "Salvation's Edge", aliases: ["Salvation's Edge", "Salvations Edge", "救赎的边缘"], releaseAt: "2024-06-07T17:00:00.000Z", windowHours: 48 },
  { name: "The Desert Perpetual", aliases: ["The Desert Perpetual", "Desert Perpetual", "沙漠永恒"], releaseAt: "2025-07-19T17:00:00.000Z", windowHours: 48 }
];

export function findRaidReleaseWindow(name: string): RaidReleaseWindow | undefined {
  const normalized = normalizeRaidNameForMatch(name);
  return RAID_RELEASE_WINDOWS.find((window) =>
    window.aliases.some((alias) => normalized.includes(normalizeRaidNameForMatch(alias)))
  );
}

export function normalizeRaidNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
