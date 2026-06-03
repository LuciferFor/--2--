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
});

function makeService(): DestinyService {
  return new DestinyService(
    new FakeBungieClient() as never,
    new MemoryCacheStore(),
    new NullStore(),
    fakeManifest as never
  );
}
