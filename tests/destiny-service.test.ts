import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/cache/cache.js";
import { NullStore } from "../src/db/store.js";
import { DestinyService } from "../src/destiny/destiny-service.js";

const fakeManifest = {
  async getDisplayName(_entityType: string, _hash: unknown, fallback: string) {
    return fallback;
  },
  async getIconPath() {
    return null;
  }
};

class FakeBungieClient {
  async post() {
    return [
      {
        displayName: "Guardian",
        bungieGlobalDisplayNameCode: 7,
        membershipType: 3,
        membershipId: "4611686018"
      }
    ];
  }

  async get(path: string) {
    if (path.includes("/Profile/")) {
      return {
        profile: {
          data: {
            userInfo: {
              bungieGlobalDisplayName: "Guardian",
              bungieGlobalDisplayNameCode: 7,
              iconPath: "/img/theme/destiny/icons/icon_psn.png"
            },
            characterIds: ["2305843009"],
            minutesPlayedTotal: "120"
          }
        },
        characters: {
          data: {
            "2305843009": {
              classType: 1,
              classHash: 671679327,
              light: 2010,
              minutesPlayedTotal: "120"
            }
          }
        }
      };
    }

    if (path.includes("/Stats/Activities/")) {
      return {
        activities: [
          {
            period: "2026-06-03T00:00:00.000Z",
            activityDetails: {
              instanceId: "123",
              referenceId: 1,
              mode: 4
            },
            values: {}
          }
        ]
      };
    }

    if (path.includes("/Stats/PostGameCarnageReport/")) {
      return {
        period: "2026-06-03T00:00:00.000Z",
        activityDetails: {
          referenceId: 1,
          mode: 4
        },
        entries: [
          {
            player: {
              destinyUserInfo: {
                bungieGlobalDisplayName: "Guardian",
                membershipType: 3,
                membershipId: "4611686018"
              }
            },
            values: {
              kills: { basic: { value: 20 } },
              deaths: { basic: { value: 4 } },
              assists: { basic: { value: 8 } }
            },
            extended: {
              weapons: []
            }
          }
        ],
        teams: []
      };
    }

    if (path.includes("/Stats/UniqueWeapons/")) {
      return {
        weapons: [
          {
            referenceId: 99,
            values: {
              uniqueWeaponKills: { basic: { value: 15 } }
            }
          }
        ]
      };
    }

    if (path.includes("/Stats/")) {
      return {
        raid: {
          allTime: {
            activitiesEntered: { basic: { value: 2 } },
            activitiesWon: { basic: { value: 1 } },
            kills: { basic: { value: 20 } },
            deaths: { basic: { value: 4 } },
            assists: { basic: { value: 8 } },
            secondsPlayed: { basic: { value: 1200 } }
          }
        }
      };
    }

    return {};
  }
}

class HeatmapBungieClient extends FakeBungieClient {
  activityCalls = 0;

  override async get(path: string, options?: { query?: Record<string, unknown> }) {
    if (!path.includes("/Stats/Activities/")) {
      return super.get(path);
    }

    this.activityCalls += 1;
    const page = Number(options?.query?.page ?? 0);
    if (page === 0) {
      return {
        activities: [
          heatmapActivity("2025-01-01T00:30:00.000Z", "9001", 3, 30, 2, 600),
          heatmapActivity("2024-02-29T12:00:00.000Z", "9002", 2, 20, 1, 300)
        ]
      };
    }
    if (page === 1) {
      return {
        activities: [heatmapActivity("2023-12-31T16:30:00.000Z", "9003", 1, 10, 1, 120)]
      };
    }
    return { activities: [] };
  }
}

describe("DestinyService", () => {
  it("searches players", async () => {
    const service = makeService();
    const result = await service.searchPlayer("Guardian#0007");
    expect(result).toMatchObject({
      displayName: "Guardian",
      membershipType: 3,
      membershipId: "4611686018"
    });
  });

  it("loads profile, summary, activities, pgcr, and weapons from mocked Bungie responses", async () => {
    const service = makeService();
    await expect(service.getProfile(3, "4611686018")).resolves.toMatchObject({
      bungieName: "Guardian#7",
      displayName: "Guardian",
      displayNameCode: 7,
      characters: [{ characterId: "2305843009", light: 2010 }]
    });
    await expect(service.getSummary(3, "4611686018", "raid")).resolves.toMatchObject({
      stats: { kills: 20, kd: 5 }
    });
    await expect(service.getActivities(3, "4611686018", "raid", 10, 0)).resolves.toHaveLength(1);
    await expect(service.getPgcr("123")).resolves.toMatchObject({
      players: [{ displayName: "Guardian", kills: 20 }]
    });
    await expect(service.getWeapons(3, "4611686018")).resolves.toMatchObject({
      weapons: [{ referenceId: "99", kills: 15 }]
    });
  });

  it("builds year heatmap calendars and caches full scans", async () => {
    const client = new HeatmapBungieClient();
    const service = new DestinyService(client as never, new MemoryCacheStore(), new NullStore(), fakeManifest as never);

    const result = await service.getHeatmap(3, "4611686018", "all", {
      range: "year",
      year: 2024,
      pages: 2,
      timezone: "Asia/Shanghai"
    });

    expect(result).toMatchObject({
      range: "year",
      year: 2024,
      activitiesScanned: 2,
      scan: {
        pagesPerCharacter: 3,
        maxPagesPerCharacter: 100,
        truncated: false
      }
    });
    const february = result.calendar[0]?.months.find((month) => month.key === "2024-02");
    expect(february).toMatchObject({ daysInMonth: 29 });
    expect(february?.days.find((day) => day.date === "2024-02-29")).toMatchObject({
      activities: 1,
      intensity: 4
    });
    expect(result.days.map((day) => day.key)).toEqual(["2024-01-01", "2024-02-29"]);

    const callsAfterFirstScan = client.activityCalls;
    await service.getHeatmap(3, "4611686018", "all", {
      range: "year",
      year: 2024,
      pages: 2,
      timezone: "Asia/Shanghai"
    });
    expect(client.activityCalls).toBe(callsAfterFirstScan);
  });
});

function makeService(): DestinyService {
  return new DestinyService(
    new FakeBungieClient() as never,
    new MemoryCacheStore(),
    new NullStore(),
    fakeManifest as never
  );
}

function heatmapActivity(period: string, instanceId: string, completed: number, kills: number, deaths: number, secondsPlayed: number) {
  return {
    period,
    activityDetails: {
      instanceId,
      referenceId: 1,
      mode: 4
    },
    values: {
      completed: { basic: { value: completed } },
      kills: { basic: { value: kills } },
      deaths: { basic: { value: deaths } },
      activityDurationSeconds: { basic: { value: secondsPlayed } }
    }
  };
}
