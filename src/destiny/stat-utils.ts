import { asRecord, numberFrom } from "../lib/json.js";

export interface HistoricalStatsSummary {
  activitiesEntered: number;
  activitiesWon: number;
  kills: number;
  deaths: number;
  assists: number;
  secondsPlayed: number;
  kd: number;
  kda: number;
  efficiency: number;
  winRate: number;
}

export const EMPTY_HISTORICAL_SUMMARY: HistoricalStatsSummary = {
  activitiesEntered: 0,
  activitiesWon: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  secondsPlayed: 0,
  kd: 0,
  kda: 0,
  efficiency: 0,
  winRate: 0
};

export function statBasicValue(values: unknown, key: string): number {
  const stat = asRecord(asRecord(values)[key]);
  const basic = asRecord(stat.basic);
  return numberFrom(basic.value);
}

export function summarizeHistoricalStats(response: unknown): HistoricalStatsSummary {
  const groups = Object.values(asRecord(response));
  const totals = { ...EMPTY_HISTORICAL_SUMMARY };

  for (const group of groups) {
    const allTime = asRecord(asRecord(group).allTime);
    totals.activitiesEntered += statBasicValue(allTime, "activitiesEntered");
    totals.activitiesWon += statBasicValue(allTime, "activitiesWon");
    totals.kills += statBasicValue(allTime, "kills");
    totals.deaths += statBasicValue(allTime, "deaths");
    totals.assists += statBasicValue(allTime, "assists");
    totals.secondsPlayed += statBasicValue(allTime, "secondsPlayed");
  }

  const deathsForRatio = totals.deaths === 0 ? 1 : totals.deaths;
  totals.kd = round(totals.kills / deathsForRatio);
  totals.kda = round((totals.kills + totals.assists / 2) / deathsForRatio);
  totals.efficiency = round((totals.kills + totals.assists) / deathsForRatio);
  totals.winRate = totals.activitiesEntered > 0 ? round((totals.activitiesWon / totals.activitiesEntered) * 100) : 0;

  return totals;
}

export function aggregatePgcrPlayerValues(values: unknown): {
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kda: number;
  efficiency: number;
  completed: boolean;
  score: number;
} {
  const kills = statBasicValue(values, "kills");
  const deaths = statBasicValue(values, "deaths");
  const assists = statBasicValue(values, "assists");
  const completed = statBasicValue(values, "completed") > 0;
  const deathsForRatio = deaths === 0 ? 1 : deaths;

  return {
    kills,
    deaths,
    assists,
    kd: round(statBasicValue(values, "killsDeathsRatio") || kills / deathsForRatio),
    kda: round(statBasicValue(values, "killsDeathsAssists") || (kills + assists / 2) / deathsForRatio),
    efficiency: round(statBasicValue(values, "efficiency") || (kills + assists) / deathsForRatio),
    completed,
    score: statBasicValue(values, "score")
  };
}

export function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
