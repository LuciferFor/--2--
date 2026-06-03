import { describe, expect, it } from "vitest";
import { aggregatePgcrPlayerValues, summarizeHistoricalStats } from "../src/destiny/stat-utils.js";

describe("stat utilities", () => {
  it("summarizes historical allTime stat groups", () => {
    const result = summarizeHistoricalStats({
      raid: {
        allTime: {
          activitiesEntered: { basic: { value: 10 } },
          activitiesWon: { basic: { value: 4 } },
          kills: { basic: { value: 100 } },
          deaths: { basic: { value: 25 } },
          assists: { basic: { value: 50 } },
          secondsPlayed: { basic: { value: 3600 } }
        }
      }
    });

    expect(result).toMatchObject({
      activitiesEntered: 10,
      activitiesWon: 4,
      kills: 100,
      deaths: 25,
      assists: 50,
      secondsPlayed: 3600,
      kd: 4,
      kda: 5,
      efficiency: 6,
      winRate: 40
    });
  });

  it("aggregates PGCR values", () => {
    expect(
      aggregatePgcrPlayerValues({
        kills: { basic: { value: 20 } },
        deaths: { basic: { value: 5 } },
        assists: { basic: { value: 8 } },
        completed: { basic: { value: 1 } }
      })
    ).toMatchObject({
      kills: 20,
      deaths: 5,
      assists: 8,
      kd: 4,
      kda: 4.8,
      efficiency: 5.6,
      completed: true
    });
  });
});
