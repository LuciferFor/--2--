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
  },
  async getDefinition(entityType: string, hash: unknown) {
    if (entityType === "DestinyInventoryItemDefinition" && String(hash) === "101") {
      return {
        displayProperties: { name: "纪念", icon: "/common/destiny2_content/icons/memorial.jpg" },
        itemTypeDisplayName: "机枪",
        inventory: { tierTypeName: "传说" },
        iconWatermark: "/common/destiny2_content/icons/watermark.png"
      };
    }
    if (entityType === "DestinyInventoryItemDefinition" && String(hash) === "102") {
      return {
        displayProperties: { name: "信任", icon: "/common/destiny2_content/icons/trust.jpg" },
        itemTypeDisplayName: "手炮",
        inventory: { tierTypeName: "传说" }
      };
    }
    if (entityType === "DestinyInventoryItemDefinition" && String(hash) === "303") {
      return {
        displayProperties: { name: "不散恐惧", icon: "/common/destiny2_content/icons/smg.jpg" },
        itemTypeDisplayName: "微型冲锋枪",
        inventory: { tierTypeName: "传说" }
      };
    }
    return null;
  },
  async getDefinitionMap(entityType: string) {
    if (entityType === "DestinyPresentationNodeDefinition") {
      return {
        "900": {
          displayProperties: { name: "锻造" },
          children: { presentationNodes: [{ presentationNodeHash: 901 }] }
        },
        "901": {
          displayProperties: { name: "突袭" },
          children: { craftables: [{ craftableItemHash: 101 }, { craftableItemHash: 102 }] }
        },
        "990": {
          displayProperties: { name: "催化" },
          children: { records: [{ recordHash: 700 }] }
        }
      };
    }
    if (entityType === "DestinyRecordDefinition") {
      return {
        "700": {
          displayProperties: {
            name: "纪念催化",
            description: "使用此武器击败目标以完成催化。",
            icon: "/common/destiny2_content/icons/catalyst.jpg"
          },
          rewardItems: [{ itemHash: 201 }],
          objectiveHashes: [9001]
        },
        "701": {
          displayProperties: { name: "普通记录" }
        }
      };
    }
    if (entityType === "DestinyInventoryItemDefinition") {
      return {
        "201": {
          displayProperties: { name: "纪念", icon: "/common/destiny2_content/icons/memorial.jpg" },
          itemTypeDisplayName: "机枪",
          inventory: { bucketTypeHash: 953998645, tierTypeName: "传说" }
        },
        "301": {
          displayProperties: { name: "纪念", icon: "/common/destiny2_content/icons/memorial.jpg" },
          itemTypeDisplayName: "机枪",
          inventory: { bucketTypeHash: 953998645, tierTypeName: "传说" }
        },
        "302": {
          displayProperties: { name: "烈日弹丸", icon: "/common/destiny2_content/icons/sunshot.jpg" },
          itemTypeDisplayName: "手炮",
          inventory: { bucketTypeHash: 2465295065, tierTypeName: "异域" }
        },
        "303": {
          displayProperties: { name: "不散恐惧", icon: "/common/destiny2_content/icons/smg.jpg" },
          itemTypeDisplayName: "微型冲锋枪",
          inventory: { bucketTypeHash: 1498876634, tierTypeName: "传说" }
        }
      };
    }
    if (entityType === "DestinyInventoryBucketDefinition") {
      return {
        "1498876634": { displayProperties: { name: "动能武器" } },
        "953998645": { displayProperties: { name: "威能武器" } },
        "2465295065": { displayProperties: { name: "能量武器" } }
      };
    }
    if (entityType === "DestinyActivityDefinition") {
      return {
        "1": {
          displayProperties: { name: "玻璃拱顶" },
          activityModeTypes: [4],
          pgcrImage: "/common/destiny2_content/icons/raid.jpg"
        },
        "7001": {
          displayProperties: {
            name: "洞悉终界：宗师",
            description: "宗师夜幕"
          },
          selectionScreenDisplayProperties: { description: "Grandmaster Nightfall" },
          activityModeTypes: [16],
          pgcrImage: "/common/destiny2_content/icons/gm.jpg"
        },
        "8001": {
          displayProperties: { name: "二象性：普通" },
          activityModeTypes: [82],
          pgcrImage: "/common/destiny2_content/icons/dungeon.jpg"
        }
      };
    }
    if (entityType === "DestinySeasonDefinition") {
      return {
        "500": {
          displayProperties: { name: "赛季：回响" },
          seasonNumber: 25,
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-12-31T00:00:00.000Z"
        }
      };
    }
    return {};
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

  async get(path: string, options?: { query?: Record<string, unknown> }) {
    if (path.includes("/Profile/")) {
      if (String(options?.query?.components || "").includes("102")) {
        return {
          profile: {
            data: {
              userInfo: {
                bungieGlobalDisplayName: "Guardian",
                bungieGlobalDisplayNameCode: 7
              },
              characterIds: ["2305843009"],
              minutesPlayedTotal: "120"
            }
          },
          characters: {
            data: {
              "2305843009": {
                classType: 2,
                classHash: 2271682572,
                light: 2010,
                minutesPlayedTotal: "120"
              }
            }
          },
          profileInventory: {
            data: {
              items: [
                {
                  itemHash: 301,
                  itemInstanceId: "691752902764",
                  quantity: 1,
                  bucketHash: 953998645,
                  state: 1
                },
                {
                  itemHash: 303,
                  itemInstanceId: "691752902766",
                  quantity: 1,
                  bucketHash: 1498876634,
                  state: 0
                }
              ]
            }
          },
          characterInventories: {
            data: {
              "2305843009": {
                items: []
              }
            }
          },
          characterEquipment: {
            data: {
              "2305843009": {
                items: [
                  {
                    itemHash: 302,
                    itemInstanceId: "691752902765",
                    quantity: 1,
                    bucketHash: 2465295065,
                    state: 0
                  }
                ]
              }
            }
          },
          characterLoadouts: {
            data: {
              "2305843009": {
                loadouts: [{ name: "Raid", items: [{ itemInstanceId: "691752902765" }] }]
              }
            }
          },
          itemComponents: {
            instances: {
              data: {
                "691752902764": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752902765": {
                  primaryStat: { value: 2000 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752902766": {
                  primaryStat: { value: 1995 },
                  canEquip: true,
                  transferStatus: 0
                }
              }
            },
            commonData: {
              data: {
                "691752902764": { isLocked: true },
                "691752902765": { isLocked: false },
                "691752902766": { isLocked: false }
              }
            }
          }
        };
      }
      if (String(options?.query?.components || "").includes("Records")) {
        return {
          profile: {
            data: {
              userInfo: {
                bungieGlobalDisplayName: "Guardian",
                bungieGlobalDisplayNameCode: 7
              },
              characterIds: ["2305843009"],
              minutesPlayedTotal: "120"
            }
          },
          characters: { data: {} },
          profileRecords: {
            data: {
              records: {
                "700": {
                  state: 4,
                  objectives: [{ objectiveHash: 9001, progress: 50, completionValue: 100, complete: false }]
                }
              }
            }
          },
          profileCollectibles: {
            data: {
              collectibles: {
                "8001": { state: 0 }
              }
            }
          },
          characterRecords: { data: {} },
          characterCollectibles: { data: {} }
        };
      }
      if (String(options?.query?.components || "").includes("Craftables")) {
        return {
          profile: {
            data: {
              userInfo: {
                bungieGlobalDisplayName: "Guardian",
                bungieGlobalDisplayNameCode: 7
              },
              characterIds: ["2305843009"],
              minutesPlayedTotal: "120"
            }
          },
          characters: { data: {} },
          characterCraftables: {
            data: {
              "2305843009": {
                craftingRootNodeHash: 900,
                craftables: {
                  "101": { visible: true, failedRequirementIndexes: [], sockets: [{}, {}] },
                  "102": { visible: true, failedRequirementIndexes: [0], sockets: [{}] }
                }
              }
            }
          }
        };
      }
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
      if (Number(options?.query?.mode) === 82) {
        return {
          activities: [
            {
              period: "2026-06-02T00:00:00.000Z",
              activityDetails: {
                instanceId: "880",
                referenceId: 8001,
                mode: 82
              },
              values: {
                completed: { basic: { value: 1 } },
                kills: { basic: { value: 80 } },
                deaths: { basic: { value: 0 } },
                activityDurationSeconds: { basic: { value: 1800 } }
              }
            }
          ]
        };
      }
      if (Number(options?.query?.mode) === 16) {
        return {
          activities: [
            {
              period: "2026-06-03T00:00:00.000Z",
              activityDetails: {
                instanceId: "990",
                referenceId: 7001,
                mode: 16
              },
              values: {
                completed: { basic: { value: 1 } },
                kills: { basic: { value: 120 } },
                deaths: { basic: { value: 3 } },
                assists: { basic: { value: 20 } },
                activityDurationSeconds: { basic: { value: 1200 } }
              }
            }
          ]
        };
      }
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
      if (path.includes("/880/")) {
        return {
          period: "2026-06-02T00:00:00.000Z",
          activityDetails: {
            referenceId: 8001,
            mode: 82
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
                kills: { basic: { value: 80 } },
                deaths: { basic: { value: 0 } },
                assists: { basic: { value: 12 } },
                completed: { basic: { value: 1 } }
              },
              extended: { weapons: [] }
            }
          ],
          teams: []
        };
      }
      if (path.includes("/990/")) {
        return {
          period: "2026-06-03T00:00:00.000Z",
          activityDetails: {
            referenceId: 7001,
            mode: 16
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
                kills: { basic: { value: 50 } },
                deaths: { basic: { value: 1 } },
                assists: { basic: { value: 6 } },
                completed: { basic: { value: 1 } }
              },
              extended: {
                weapons: [{ referenceId: 99, values: { kills: { basic: { value: 30 } } } }]
              }
            },
            {
              player: {
                destinyUserInfo: {
                  bungieGlobalDisplayName: "Teammate",
                  membershipType: 3,
                  membershipId: "4611686019"
                }
              },
              values: {
                kills: { basic: { value: 40 } },
                deaths: { basic: { value: 2 } },
                assists: { basic: { value: 8 } },
                completed: { basic: { value: 1 } }
              },
              extended: { weapons: [] }
            }
          ],
          teams: []
        };
      }
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

    if (path.includes("/Stats/AggregateActivityStats/")) {
      return {
        activities: [
          {
            activityHash: 8001,
            values: {
              activityCompletions: { basic: { value: 7 } },
              activityWins: { basic: { value: 5 } },
              activityKills: { basic: { value: 800 } },
              activityDeaths: { basic: { value: 20 } },
              activitySecondsPlayed: { basic: { value: 18000 } },
              fastestCompletionMsForActivity: {
                basic: { value: 1800000, displayValue: "30m 00s" },
                activityId: "880"
              }
            }
          },
          {
            activityHash: 7001,
            values: {
              activityCompletions: { basic: { value: 5 } },
              activityWins: { basic: { value: 4 } },
              activityKills: { basic: { value: 300 } },
              activityDeaths: { basic: { value: 15 } },
              activitySecondsPlayed: { basic: { value: 7200 } },
              fastestCompletionMsForActivity: {
                basic: { value: 1200000, displayValue: "20m 00s" },
                activityId: "990"
              }
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
    await expect(service.getCraftables(3, "4611686018")).resolves.toMatchObject({
      totals: { weapons: 2, unlocked: 1, locked: 1 },
      groups: [
        {
          name: "突袭",
          items: [
            { itemHash: "101", name: "纪念", unlocked: true },
            { itemHash: "102", name: "信任", unlocked: false }
          ]
        }
      ]
    });
    await expect(service.getCatalysts(3, "4611686018", "access-token")).resolves.toMatchObject({
      totals: { catalysts: 1, completed: 0, incomplete: 1 },
      groups: [
        {
          key: "power",
          name: "威能武器",
          items: [
            {
              recordHash: "700",
              weaponHash: "201",
              name: "纪念",
              itemTypeDisplayName: "机枪",
              percent: 50,
              progress: 50,
              completionValue: 100
            }
          ]
        }
      ],
      scan: { candidateRecords: 1, recordsReturned: 1, collectiblesReturned: 1 }
    });
    await expect(service.getPrivateInventory(3, "4611686018", "access-token", "607972716")).resolves.toMatchObject({
      qq: "607972716",
      totals: { items: 3, vault: 2, inventory: 0, equipped: 1 },
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "纪念",
          owner: "vault",
          itemInstanceId: "691752902764",
          bucketName: "威能武器",
          power: 2010,
          locked: true
        }),
        expect.objectContaining({
          name: "烈日弹丸",
          owner: "equipped",
          bucketName: "能量武器",
          power: 2000,
          locked: false
        }),
        expect.objectContaining({
          name: "不散恐惧",
          owner: "vault",
          itemTypeDisplayName: "微型冲锋枪",
          bucketName: "动能武器",
          power: 1995
        })
      ])
    });
    for (const query of ["冲锋枪", "微冲", "微冲枪", "SMG", "所有冲锋枪", "的所有冲锋枪"]) {
      await expect(
        service.searchPrivateInventory(3, "4611686018", "access-token", {
          qq: "607972716",
          query,
          bucket: "vault"
        })
      ).resolves.toMatchObject({
        total: 1,
        items: [
          expect.objectContaining({
            name: "不散恐惧",
            owner: "vault",
            itemTypeDisplayName: "微型冲锋枪"
          })
        ]
      });
    }
    await expect(
      service.searchPrivateInventory(3, "4611686018", "access-token", {
        qq: "607972716",
        query: "所有手炮",
        bucket: "vault"
      })
    ).resolves.toMatchObject({ total: 0 });
    await expect(service.getLoadouts(3, "4611686018", "access-token", "607972716")).resolves.toMatchObject({
      qq: "607972716",
      loadouts: [{ index: 0, characterId: "2305843009", name: "Raid", itemCount: 1 }]
    });
    await expect(
      service.getDungeonOverview(3, "4611686018", { historyPages: 1, pgcrLimit: 5 })
    ).resolves.toMatchObject({
      totals: {
        dungeons: 1,
        fullClears: 5,
        completions: 7,
        fastestCompletionDisplay: "30m 00s"
      },
      dungeons: [
        {
          name: "二象性",
          difficultyLabel: "普通",
          fullClears: 5,
          completions: 7,
          fastestCompletionDisplay: "30m 00s",
          fireteamSizes: { solo: 1 },
          flawless: { status: "confirmed", personal: true, fireteam: true },
          tags: expect.arrayContaining(["Solo", "Flawless Solo"])
        }
      ],
      activities: [{ name: "二象性" }],
      scan: { recentActivitiesScanned: 1, pgcrScanned: 1 }
    });
    await expect(
      service.getGrandmasterOverview(3, "4611686018", { historyPages: 1, pgcrLimit: 5, season: "current" })
    ).resolves.toMatchObject({
      season: { currentSeasonReliable: true, currentSeasonName: "赛季：回响" },
      totals: { strikes: 1, currentSeasonClears: 1, lifetimeClears: 4 },
      strikes: [
        {
          name: "洞悉终界",
          currentSeasonClears: 1,
          lifetimeClears: 4,
          fastestCompletionDisplay: "20m 00s",
          completionRate: 100
        }
      ],
      recent: [
        {
          activityId: "990",
          activityName: "洞悉终界",
          completed: true,
          players: expect.arrayContaining([
            expect.objectContaining({
              displayName: "Guardian",
              kills: 50,
              weapons: [expect.objectContaining({ referenceId: "99" })]
            })
          ])
        }
      ],
      scan: { recentActivitiesScanned: 1, pgcrScanned: 1 }
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
