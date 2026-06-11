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
          children: { craftables: [{ craftableItemHash: 101 }, { craftableItemHash: 102 }, { craftableItemHash: 601 }] }
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
        "702": {
          displayProperties: {
            name: "挽歌催化",
            description: "用挽歌击败目标以解锁催化效果。",
            icon: "/common/destiny2_content/icons/lament-catalyst.jpg"
          },
          rewardItems: [{ itemHash: 502 }],
          objectiveHashes: [9002]
        },
        "703": {
          displayProperties: {
            name: "低语催化",
            description: "用蠕虫低语击败目标以解锁催化效果。",
            icon: "/common/destiny2_content/icons/whisper-catalyst.jpg"
          },
          rewardItems: [{ itemHash: 503 }],
          objectiveHashes: [9003]
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
        "202": {
          displayProperties: { name: "挽歌", icon: "/common/destiny2_content/icons/lament.jpg" },
          itemTypeDisplayName: "刀剑",
          inventory: { bucketTypeHash: 953998645, tierTypeName: "异域" }
        },
        "203": {
          displayProperties: { name: "蠕虫低语", icon: "/common/destiny2_content/icons/whisper.jpg" },
          itemTypeDisplayName: "狙击步枪",
          inventory: { bucketTypeHash: 953998645, tierTypeName: "异域" }
        },
        "502": {
          displayProperties: {
            name: "挽歌催化剂",
            description: "将此武器升级为大师杰作。\n\n使用此武器消灭目标以解锁这项升级。",
            icon: "/common/destiny2_content/icons/lament-catalyst.jpg"
          },
          itemTypeDisplayName: "催化剂",
          perks: [{ perkHash: 9102 }],
          inventory: { tierTypeName: "异域" }
        },
        "503": {
          displayProperties: {
            name: "蠕虫低语催化剂",
            description: "将此武器升级为大师杰作。\n\n使用此武器消灭目标以解锁这项升级。",
            icon: "/common/destiny2_content/icons/whisper-catalyst.jpg"
          },
          itemTypeDisplayName: "催化剂",
          perks: [{ perkHash: 9103 }],
          inventory: { tierTypeName: "异域" }
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
          inventory: { bucketTypeHash: 1498876634, bucketTypeName: "动能武器", tierTypeName: "传说" },
          defaultDamageType: 6,
          investmentStats: [{ statTypeHash: 4284893193, value: 900 }],
          sockets: {
            socketEntries: [
              { singleInitialItemHash: 602 },
              { randomizedPlugSetHash: 8801 },
              { reusablePlugSetHash: 8802 }
            ]
          }
        },
        "304": {
          displayProperties: { name: "玫瑰", icon: "/common/destiny2_content/icons/rose.jpg" },
          itemTypeDisplayName: "手炮",
          inventory: { bucketTypeHash: 1498876634, tierTypeName: "传说" }
        },
        "305": {
          displayProperties: { name: "喷子测试", icon: "/common/destiny2_content/icons/shotgun.jpg" },
          itemTypeDisplayName: "霰弹枪",
          inventory: { bucketTypeHash: 2465295065, bucketTypeName: "能量武器", tierTypeName: "传说" },
          investmentStats: [{ statTypeHash: 4284893193, value: 55 }],
          sockets: { socketEntries: [{ randomizedPlugSetHash: 8802 }] }
        },
        "401": {
          displayProperties: { name: "配装头盔", icon: "/common/destiny2_content/icons/helmet.jpg" },
          itemTypeDisplayName: "头盔",
          classType: 2,
          inventory: { bucketTypeHash: 3448274439, bucketTypeName: "头盔", tierTypeName: "传说" }
        },
        "402": {
          displayProperties: { name: "配装臂铠", icon: "/common/destiny2_content/icons/gauntlets.jpg" },
          itemTypeDisplayName: "臂铠",
          classType: 2,
          inventory: { bucketTypeHash: 3551918588, bucketTypeName: "臂铠", tierTypeName: "传说" }
        },
        "403": {
          displayProperties: { name: "配装胸甲", icon: "/common/destiny2_content/icons/chest.jpg" },
          itemTypeDisplayName: "胸甲",
          classType: 2,
          inventory: { bucketTypeHash: 14239492, bucketTypeName: "胸甲", tierTypeName: "传说" }
        },
        "404": {
          displayProperties: { name: "配装腿甲", icon: "/common/destiny2_content/icons/legs.jpg" },
          itemTypeDisplayName: "腿甲",
          classType: 2,
          inventory: { bucketTypeHash: 20886954, bucketTypeName: "腿甲", tierTypeName: "传说" }
        },
        "405": {
          displayProperties: { name: "配装臂环", icon: "/common/destiny2_content/icons/bond.jpg" },
          itemTypeDisplayName: "职业物品",
          classType: 2,
          inventory: { bucketTypeHash: 1585787867, bucketTypeName: "职业物品", tierTypeName: "传说" }
        },
        "601": {
          displayProperties: {
            name: "极高反射",
            description: "一把来自木卫二的轻型手枪。",
            icon: "/common/destiny2_content/icons/high-albedo.jpg"
          },
          itemTypeDisplayName: "手枪",
          inventory: { bucketTypeHash: 1498876634, bucketTypeName: "动能武器", tierTypeName: "传说" },
          displaySource: "来源：木卫二活动",
          equippingBlock: { ammoType: 1 },
          defaultDamageType: 1,
          investmentStats: [
            { statTypeHash: 4284893193, value: 491 },
            { statTypeHash: 3871231066, value: 45 }
          ],
          perks: [{ perkHash: 9104 }],
          sockets: { socketEntries: [{ singleInitialItemHash: 602 }] },
          quality: { displayVersionWatermarkIcons: ["/common/destiny2_content/icons/watermark.png"] }
        },
        "602": {
          displayProperties: {
            name: "轻质框架",
            description: "手感绝佳。装备此武器时移动速度更快。",
            icon: "/common/destiny2_content/icons/lightweight-frame.jpg"
          },
          itemTypeDisplayName: "固有特性",
          inventory: { tierTypeName: "传说" }
        },
        "88001": {
          displayProperties: {
            name: "爆破专家",
            description: "使用此武器造成击杀会生成手雷能量。"
          },
          itemTypeDisplayName: "武器特性",
          inventory: { tierTypeName: "传说" }
        },
        "88002": {
          displayProperties: {
            name: "斩首武器",
            description: "对首领、载具和守护者超能造成额外伤害。"
          },
          itemTypeDisplayName: "武器特性",
          inventory: { tierTypeName: "传说" }
        }
      };
    }
    if (entityType === "DestinyPlugSetDefinition") {
      return {
        "8801": {
          reusablePlugItems: [{ plugItemHash: 88001 }, { plugItemHash: 88002 }]
        },
        "8802": {
          reusablePlugItems: [{ plugItemHash: 88001 }]
        }
      };
    }
    if (entityType === "DestinyInventoryBucketDefinition") {
      return {
        "1498876634": { displayProperties: { name: "动能武器" } },
        "953998645": { displayProperties: { name: "威能武器" } },
        "2465295065": { displayProperties: { name: "能量武器" } },
        "3448274439": { displayProperties: { name: "头盔" } },
        "3551918588": { displayProperties: { name: "臂铠" } },
        "14239492": { displayProperties: { name: "胸甲" } },
        "20886954": { displayProperties: { name: "腿甲" } },
        "1585787867": { displayProperties: { name: "职业物品" } }
      };
    }
    if (entityType === "DestinyStatDefinition") {
      return {
        "2996146975": { displayProperties: { name: "机动" } },
        "392767087": { displayProperties: { name: "韧性" } },
        "1943323491": { displayProperties: { name: "恢复" } },
        "1735777505": { displayProperties: { name: "纪律" } },
        "144602215": { displayProperties: { name: "智慧" } },
        "4244567218": { displayProperties: { name: "力量" } },
        "4284893193": { displayProperties: { name: "每分钟发射数" } },
        "3871231066": { displayProperties: { name: "弹匣" } }
      };
    }
    if (entityType === "DestinyObjectiveDefinition") {
      return {
        "9001": { displayProperties: { description: "击败目标" }, completionValue: 100 },
        "9002": { displayProperties: { description: "使用挽歌击败目标" }, completionValue: 400 },
        "9003": { displayProperties: { description: "使用蠕虫低语击败目标" }, completionValue: 500 }
      };
    }
    if (entityType === "DestinySandboxPerkDefinition") {
      return {
        "9102": {
          displayProperties: { name: "燃烧野心", description: "造成持续伤害会灼烧目标。" },
          isDisplayable: true
        },
        "9103": {
          displayProperties: { name: "屏息", description: "瞄准一小段时间后提高精准伤害。" },
          isDisplayable: true
        },
        "9104": {
          displayProperties: { name: "适配框架", description: "均衡可靠，适合多种战斗场景。" },
          isDisplayable: true
        }
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
          activityModeTypes: [46, 18, 7],
          directActivityModeType: 46,
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

function optimizerArmorStats(values: Partial<Record<"mobility" | "resilience" | "recovery" | "discipline" | "intellect" | "strength", number>>) {
  const statHashes = {
    mobility: 2996146975,
    resilience: 392767087,
    recovery: 1943323491,
    discipline: 1735777505,
    intellect: 144602215,
    strength: 4244567218
  };
  return {
    stats: Object.fromEntries(
      Object.entries(statHashes).map(([key, hash]) => [
        String(hash),
        {
          value: values[key as keyof typeof statHashes] ?? 0
        }
      ])
    )
  };
}

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
                },
                {
                  itemHash: 304,
                  itemInstanceId: "691752902767",
                  quantity: 1,
                  bucketHash: 1498876634,
                  state: 1
                },
                {
                  itemHash: 401,
                  itemInstanceId: "691752903001",
                  quantity: 1,
                  bucketHash: 3448274439,
                  state: 0
                },
                {
                  itemHash: 402,
                  itemInstanceId: "691752903002",
                  quantity: 1,
                  bucketHash: 3551918588,
                  state: 0
                },
                {
                  itemHash: 403,
                  itemInstanceId: "691752903003",
                  quantity: 1,
                  bucketHash: 14239492,
                  state: 0
                },
                {
                  itemHash: 404,
                  itemInstanceId: "691752903004",
                  quantity: 1,
                  bucketHash: 20886954,
                  state: 0
                },
                {
                  itemHash: 405,
                  itemInstanceId: "691752903005",
                  quantity: 1,
                  bucketHash: 1585787867,
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
                },
                "691752902767": {
                  primaryStat: { value: 1990 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752903001": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752903002": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752903003": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752903004": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                },
                "691752903005": {
                  primaryStat: { value: 2010 },
                  canEquip: true,
                  transferStatus: 0
                }
              }
            },
            commonData: {
              data: {
                "691752902764": { isLocked: true },
                "691752902765": { isLocked: false },
                "691752902766": { isLocked: false },
                "691752902767": { isLocked: true },
                "691752903001": { isLocked: false },
                "691752903002": { isLocked: false },
                "691752903003": { isLocked: false },
                "691752903004": { isLocked: false },
                "691752903005": { isLocked: false }
              }
            },
            stats: {
              data: {
                "691752902764": { stats: { "4284893193": { value: 450 } } },
                "691752902765": { stats: { "4284893193": { value: 150 } } },
                "691752902766": { stats: { "4284893193": { value: 900 } } },
                "691752902767": { stats: { "4284893193": { value: 120 } } },
                "691752903001": optimizerArmorStats({ recovery: 20, discipline: 20, strength: 20 }),
                "691752903002": optimizerArmorStats({ recovery: 20, discipline: 20, strength: 20 }),
                "691752903003": optimizerArmorStats({ recovery: 20, discipline: 20, strength: 20 }),
                "691752903004": optimizerArmorStats({ recovery: 10, discipline: 20, strength: 20 }),
                "691752903005": optimizerArmorStats({ recovery: 10, discipline: 10, strength: 20 })
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
                },
                "703": {
                  state: 4,
                  objectives: [{ objectiveHash: 9003, progress: 120, completionValue: 500, complete: false }]
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
      if (Number(options?.query?.mode) === 46) {
        return {
          activities: [
            {
              period: "2026-06-03T00:00:00.000Z",
              activityDetails: {
                instanceId: "990",
                referenceId: 7001,
                mode: 46
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
            mode: 46
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

class RaidAggregateFailingBungieClient extends FakeBungieClient {
  override async get(path: string, options?: { query?: Record<string, unknown> }) {
    if (path.includes("/Stats/AggregateActivityStats/")) {
      throw new Error("aggregate unavailable");
    }
    if (path.includes("/Stats/Activities/") && Number(options?.query?.mode) === 4) {
      return {
        activities: [
          {
            period: "2026-06-03T00:00:00.000Z",
            activityDetails: {
              instanceId: "123",
              referenceId: 1,
              mode: 4
            },
            values: {
              completed: { basic: { value: 1 } },
              kills: { basic: { value: 20 } },
              deaths: { basic: { value: 4 } },
              activityDurationSeconds: { basic: { value: 1200 } }
            }
          }
        ]
      };
    }
    return super.get(path, options);
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
    const catalysts = await service.getCatalysts(3, "4611686018", "access-token");
    expect(catalysts).toMatchObject({
      totals: { catalysts: 3, completed: 0, incomplete: 3 },
      scan: { candidateRecords: 3, recordsReturned: 2, collectiblesReturned: 1 }
    });
    expect(catalysts.groups).toMatchObject([{ key: "power", name: "威能武器" }]);
    expect(catalysts.groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordHash: "700",
          weaponHash: "201",
          name: "纪念",
          itemTypeDisplayName: "机枪",
          percent: 50,
          progress: 50,
          completionValue: 100
        }),
        expect.objectContaining({
          recordHash: "702",
          weaponHash: "202",
          name: "挽歌",
          itemTypeDisplayName: "刀剑",
          percent: 0,
          progress: 0,
          completionValue: 0
        }),
        expect.objectContaining({
          recordHash: "703",
          name: "蠕虫低语",
          itemTypeDisplayName: "狙击步枪",
          slot: "power",
          slotLabel: "威能武器",
          percent: 24,
          progress: 120,
          completionValue: 500
        })
      ])
    );
    await expect(service.getCatalystInfo("挽歌")).resolves.toMatchObject({
      query: "挽歌",
      total: 1,
      matches: [
        {
          recordHash: "702",
          weaponHash: "202",
          catalystItemHash: "502",
          weaponName: "挽歌",
          catalystName: "挽歌催化",
          effectDescription: "燃烧野心：造成持续伤害会灼烧目标。",
          completionDescription: "使用挽歌击败目标",
          itemTypeDisplayName: "刀剑",
          slot: "power",
          objectives: [{ objectiveHash: "9002", description: "使用挽歌击败目标", completionValue: 400 }]
        }
      ]
    });
    await expect(service.getItemInfo("查个武器，极高反射")).resolves.toMatchObject({
      query: "查个武器，极高反射",
      total: 1,
      matches: [
        {
          itemHash: "601",
          name: "极高反射",
          itemTypeDisplayName: "手枪",
          tierTypeName: "传说",
          slotLabel: "动能",
          damageType: "动能",
          ammoType: "主弹药",
          source: "来源：木卫二活动",
          craftable: true,
          stats: expect.arrayContaining([
            expect.objectContaining({ name: "每分钟发射数", value: 491 }),
            expect.objectContaining({ name: "弹匣", value: 45 })
          ]),
          perks: expect.arrayContaining([
            expect.objectContaining({ name: "适配框架" }),
            expect.objectContaining({ name: "轻质框架" })
          ]),
          match: { reason: "名称精确匹配" }
        }
      ]
    });
    await expect(service.getPerkWeapons({ perks: ["爆破专家", "斩首武器"], weaponType: "冲锋枪", limit: 50 })).resolves.toMatchObject({
      perks: ["爆破专家", "斩首武器"],
      filters: { weaponType: "冲锋枪", limit: 50 },
      total: 1,
      matches: [
        {
          name: "不散恐惧",
          itemTypeDisplayName: "微型冲锋枪",
          rpm: 900,
          matchedPerks: expect.arrayContaining([
            expect.objectContaining({ name: "爆破专家" }),
            expect.objectContaining({ name: "斩首武器" })
          ])
        }
      ]
    });
    await expect(service.getPerkWeapons({ perks: ["爆破专家", "斩首武器"], weaponType: "霰弹枪", limit: 50 })).resolves.toMatchObject({
      total: 0,
      matches: []
    });
    await expect(service.getCatalystStatus(3, "4611686018", "access-token", "查询下虫狙的催化")).resolves.toMatchObject({
      query: "查询下虫狙的催化",
      total: 1,
      totals: { obtained: 1, visible: 1, completed: 0 },
      matches: [
        {
          recordHash: "703",
          weaponName: "蠕虫低语",
          catalystName: "低语催化",
          itemTypeDisplayName: "狙击步枪",
          slot: "power",
          slotLabel: "威能武器",
          effectDescription: "屏息：瞄准一小段时间后提高精准伤害。",
          progress: 120,
          completionValue: 500,
          objectives: [{ objectiveHash: "9003", description: "使用蠕虫低语击败目标", progress: 120, completionValue: 500 }]
        }
      ]
    });
    await expect(service.getPrivateInventory(3, "4611686018", "access-token", "607972716")).resolves.toMatchObject({
      qq: "607972716",
      totals: { items: 9, vault: 8, inventory: 0, equipped: 1 },
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
          power: 1995,
          weaponStats: expect.objectContaining({ rpm: 900 })
        }),
        expect.objectContaining({
          name: "玫瑰",
          owner: "vault",
          itemTypeDisplayName: "手炮",
          bucketName: "动能武器",
          weaponStats: expect.objectContaining({ rpm: 120 })
        }),
        expect.objectContaining({
          name: "配装头盔",
          owner: "vault",
          bucketName: "头盔",
          armorStats: expect.objectContaining({
            total: 60,
            stats: expect.arrayContaining([
              expect.objectContaining({ hash: 392767087, name: "生命值" }),
              expect.objectContaining({ hash: 1943323491, name: "职业" }),
              expect.objectContaining({ hash: 1735777505, name: "手雷" })
            ])
          })
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
    ).resolves.toMatchObject({
      query: "",
      weaponType: "手炮",
      total: 1,
      items: [expect.objectContaining({ name: "玫瑰", weaponStats: expect.objectContaining({ rpm: 120 }) })]
    });
    await expect(
      service.searchPrivateInventory(3, "4611686018", "access-token", {
        qq: "607972716",
        query: "",
        bucket: "vault",
        weaponType: "手炮",
        rpm: 120
      })
    ).resolves.toMatchObject({
      query: "",
      weaponType: "手炮",
      rpm: 120,
      total: 1,
      items: [expect.objectContaining({ name: "玫瑰", owner: "vault" })]
    });
    await expect(
      service.searchPrivateInventory(3, "4611686018", "access-token", {
        qq: "607972716",
        query: "120射速手炮",
        bucket: "vault"
      })
    ).resolves.toMatchObject({
      query: "",
      weaponType: "手炮",
      rpm: 120,
      total: 1,
      items: [expect.objectContaining({ name: "玫瑰", owner: "vault" })]
    });
    await expect(
      service.searchPrivateInventory(3, "4611686018", "access-token", {
        qq: "607972716",
        query: "",
        bucket: "vault",
        weaponType: "手炮",
        rpm: 140
      })
    ).resolves.toMatchObject({ total: 0 });
    await expect(service.getLoadouts(3, "4611686018", "access-token", "607972716")).resolves.toMatchObject({
      qq: "607972716",
      loadouts: [{ index: 0, characterId: "2305843009", name: "Raid", itemCount: 1 }]
    });
    const optimizer = await service.searchLoadoutOptimizer(3, "4611686018", "access-token", {
      qq: "607972716",
      className: "术士",
      targetStats: { class: 100, grenade: 100, melee: 100 },
      includeCurrentSubclassFragments: true,
      simulateStatMods: true,
      limit: 2
    });
    expect(optimizer).toMatchObject({
      qq: "607972716",
      className: "术士",
      classType: 2,
      targets: expect.arrayContaining([
        expect.objectContaining({ key: "recovery", name: "职业", target: 100 }),
        expect.objectContaining({ key: "discipline", target: 100 }),
        expect.objectContaining({ key: "strength", name: "近战", target: 100 })
      ]),
      scan: { candidateArmorItems: 5 },
      builds: [
        expect.objectContaining({
          buildId: "b1",
          achieved: true,
          armor: expect.arrayContaining([
            expect.objectContaining({ name: "配装头盔", slot: "helmet" }),
            expect.objectContaining({ name: "配装臂环", slot: "class_item" })
          ]),
          statMods: expect.arrayContaining([
            expect.objectContaining({ statKey: "recovery", statName: "职业", value: 20, count: 2 }),
            expect.objectContaining({ statKey: "discipline", value: 10, count: 1 })
          ])
        })
      ]
    });
    await expect(
      service.applyLoadoutOptimizerBuild(3, "4611686018", "access-token", {
        qq: "607972716",
        sessionId: optimizer.sessionId,
        buildId: "b1",
        confirm: true
      })
    ).resolves.toMatchObject({
      qq: "607972716",
      buildId: "b1",
      transferredItemIds: expect.arrayContaining(["691752903001", "691752903005"]),
      equippedItemIds: expect.arrayContaining(["691752903001", "691752903005"]),
      statMods: expect.arrayContaining([expect.objectContaining({ statKey: "recovery", statName: "职业" })])
    });
    await expect(
      service.searchLoadoutOptimizer(3, "4611686018", "access-token", {
        qq: "607972716",
        className: "术士"
      })
    ).rejects.toThrow(/targetStats/);
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

  it("returns raid overview from recent history when aggregate stats fail", async () => {
    const service = new DestinyService(
      new RaidAggregateFailingBungieClient() as never,
      new MemoryCacheStore(),
      new NullStore(),
      fakeManifest as never
    );

    const result = await service.getRaidOverview(3, "4611686018", { historyPages: 1, pgcrLimit: 1 });

    expect(result).toMatchObject({
      totals: {
        raids: 1,
        clears: 1,
        completions: 1,
        kills: 20,
        deaths: 4,
        secondsPlayed: 1200
      },
      scan: {
        aggregateStatsAvailable: false,
        aggregateCharactersScanned: 0,
        recentActivitiesScanned: 1,
        pgcrScanned: 1
      },
      raids: [
        {
          name: "玻璃拱顶",
          fullClears: 1,
          completions: 1,
          kills: 20,
          deaths: 4,
          secondsPlayed: 1200
        }
      ]
    });
    expect(result.scan.aggregateErrors?.[0]).toContain("aggregate unavailable");
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
