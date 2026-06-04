import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryCacheStore } from "../src/cache/cache.js";
import { makeTestConfig } from "../src/config.js";
import { NullStore } from "../src/db/store.js";
import { QqOAuthService } from "../src/oauth/qq-oauth-service.js";

const fakeDestinyService = {
  async searchPlayer() {
    return {
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7,
      membershipType: 3,
      membershipId: "4611686018"
    };
  },
  async getProfile() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      bungieName: "Guardian#7",
      displayName: "Guardian",
      displayNameCode: 7,
      profile: {
        characterIds: ["2305843009"],
        minutesPlayedTotal: 10
      },
      characters: []
    };
  },
  async getSummary() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      mode: "all",
      modeLabel: "全部",
      updatedAt: "2026-06-03T00:00:00.000Z",
      stats: {
        activitiesEntered: 1,
        activitiesWon: 1,
        kills: 10,
        deaths: 1,
        assists: 2,
        secondsPlayed: 100,
        kd: 10,
        kda: 11,
        efficiency: 12,
        winRate: 100
      }
    };
  },
  async getCareerSummary() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      modes: [
        {
          membershipType: 3,
          membershipId: "4611686018",
          mode: "all",
          modeLabel: "全部",
          updatedAt: "2026-06-03T00:00:00.000Z",
          stats: {
            activitiesEntered: 1,
            activitiesWon: 1,
            kills: 10,
            deaths: 1,
            assists: 2,
            secondsPlayed: 100,
            kd: 10,
            kda: 11,
            efficiency: 12,
            winRate: 100
          }
        }
      ],
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getPvpOverview() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      summary: await fakeDestinyService.getSummary(),
      trials: await fakeDestinyService.getSummary(),
      recent: [],
      aggregates: {
        matchesScanned: 2,
        wins: 1,
        losses: 1,
        kills: 30,
        deaths: 10,
        assists: 8,
        kd: 3,
        kda: 3.4,
        winRate: 50,
        bestKills: 20,
        bestKd: 5,
        flawlessMatches: 0
      },
      kdComparison: [
        {
          activityId: "123",
          activityName: "Javelin-4",
          result: "win",
          playerKd: 3,
          teamKd: 1.4,
          opponentKd: 1.1
        }
      ],
      recentWeapons: [
        {
          referenceId: "1",
          name: "Rose",
          kills: 12,
          precisionKills: 6,
          secondsUsed: 0,
          matchesUsed: 2
        }
      ],
      modeBreakdown: [
        {
          modeName: "Control",
          matches: 2,
          wins: 1,
          losses: 1,
          kills: 30,
          deaths: 10,
          assists: 8,
          kd: 3,
          winRate: 50
        }
      ],
      matches: [
        {
          activityId: "123",
          activityName: "Javelin-4",
          modeName: "Control",
          result: "win",
          kills: 20,
          deaths: 4,
          assists: 5,
          kd: 5,
          kda: 5.63,
          completed: true,
          teamKd: 1.4,
          opponentKd: 1.1,
          weapons: []
        }
      ],
      weapons: [],
      weaponScope: "all-time unique weapon history",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getActivities() {
    return [
      {
        period: "2026-06-03T00:00:00.000Z",
        activityId: "123",
        activityName: "Activity",
        values: {}
      }
    ];
  },
  async getDungeonOverview() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      mode: "dungeon",
      modeLabel: "地牢",
      totals: {
        activities: 1,
        dungeons: 1,
        clears: 2,
        fullClears: 2,
        completions: 2,
        sherpaCompletions: 0,
        kills: 50,
        deaths: 5,
        secondsPlayed: 1800,
        fastestCompletionDisplay: "15:00.000"
      },
      activities: [
        {
          name: "Duality",
          displayName: "Duality：普通",
          difficulty: "normal",
          difficultyLabel: "普通",
          activityHashes: [2],
          clears: 2,
          fullClears: 2,
          completions: 2,
          wins: 2,
          kills: 50,
          deaths: 5,
          secondsPlayed: 1800,
          fastestCompletionDisplay: "15:00.000",
          scannedCompletions: 0,
          sherpaCompletions: 0,
          fireteamSizes: { solo: 0, duo: 0, trio: 0 },
          tags: [],
          flawless: { status: "unknown", personal: false, fireteam: false },
          sortOrder: 0
        }
      ],
      dungeons: [
        {
          name: "Duality",
          displayName: "Duality：普通",
          difficulty: "normal",
          difficultyLabel: "普通",
          activityHashes: [2],
          clears: 2,
          fullClears: 2,
          completions: 2,
          wins: 2,
          kills: 50,
          deaths: 5,
          secondsPlayed: 1800,
          fastestCompletionDisplay: "15:00.000",
          scannedCompletions: 0,
          sherpaCompletions: 0,
          fireteamSizes: { solo: 0, duo: 0, trio: 0 },
          tags: [],
          flawless: { status: "unknown", personal: false, fireteam: false },
          sortOrder: 0
        }
      ],
      scan: {
        historyPages: 1,
        pgcrLimit: 100,
        recentActivitiesScanned: 0,
        pgcrScanned: 0,
        note: "test"
      },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getGrandmasterOverview() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      season: {
        scope: "current",
        currentSeasonName: "赛季：回响",
        currentSeasonStart: "2026-01-01T00:00:00.000Z",
        currentSeasonEnd: "2026-12-31T00:00:00.000Z",
        currentSeasonReliable: true
      },
      totals: {
        strikes: 1,
        currentSeasonClears: 2,
        lifetimeClears: 5,
        attempts: 3,
        completions: 5,
        kills: 300,
        deaths: 10,
        secondsPlayed: 7200,
        fastestCompletionMs: 1200000,
        fastestCompletionDisplay: "20m 00s",
        averageCompletionSeconds: 1440
      },
      strikes: [
        {
          name: "洞悉终界",
          activityHashes: [7001],
          currentSeasonClears: 2,
          lifetimeClears: 5,
          attempts: 3,
          completions: 5,
          kills: 300,
          deaths: 10,
          secondsPlayed: 7200,
          fastestCompletionMs: 1200000,
          fastestCompletionDisplay: "20m 00s",
          averageCompletionSeconds: 1440,
          completionRate: 66.67
        }
      ],
      recent: [],
      scan: {
        historyPages: 10,
        pgcrLimit: 50,
        season: "current",
        recentActivitiesScanned: 3,
        pgcrScanned: 2,
        currentSeasonReliable: true,
        note: "test"
      },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getHeatmap() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      mode: "all",
      modeLabel: "全部",
      timezone: "Asia/Shanghai",
      range: "all",
      activitiesScanned: 1,
      days: [{ key: "2026-06-03", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 }],
      hours: [{ key: "20", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 }],
      calendar: [
        {
          year: 2026,
          totals: { key: "2026", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 },
          months: [
            {
              key: "2026-06",
              year: 2026,
              month: 6,
              label: "2026年6月",
              firstWeekday: 0,
              daysInMonth: 30,
              totals: { key: "2026-06", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 },
              days: [
                {
                  key: "2026-06-03",
                  date: "2026-06-03",
                  day: 3,
                  weekday: 2,
                  week: 0,
                  intensity: 4,
                  activities: 1,
                  completed: 1,
                  kills: 10,
                  deaths: 1,
                  secondsPlayed: 100
                }
              ]
            }
          ]
        }
      ],
      scan: {
        range: "all",
        pagesPerCharacter: 1,
        maxPagesPerCharacter: 100,
        truncated: false,
        note: "test"
      },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getNamecard() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      profile: await fakeDestinyService.getProfile(),
      summary: await fakeDestinyService.getSummary(),
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getRaidOverview() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      totals: {
        raids: 1,
        clears: 3,
        kills: 100,
        deaths: 10,
        secondsPlayed: 3600
      },
      raids: [
        {
          name: "Last Wish",
          activityHashes: [1],
          clears: 3,
          completions: 3,
          wins: 3,
          kills: 100,
          deaths: 10,
          secondsPlayed: 3600,
          fastestCompletionMs: 1800000,
          fastestCompletionDisplay: "30:00.000",
          flawless: { status: "unknown", personal: false, fireteam: false },
          dayOne: { status: "unknown", releaseAt: "2018-09-14T17:00:00.000Z", windowHours: 24 }
        }
      ],
      scan: {
        historyPages: 1,
        pgcrLimit: 40,
        recentActivitiesScanned: 0,
        pgcrScanned: 0,
        note: "test"
      },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getPgcr() {
    return {
      activityId: "123",
      activityName: "Activity",
      players: [],
      teams: []
    };
  },
  async getWeapons() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      weapons: [],
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getCraftables() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      totals: { groups: 1, weapons: 2, unlocked: 1, locked: 1 },
      groups: [
        {
          key: "突袭",
          name: "突袭",
          total: 2,
          unlocked: 1,
          locked: 1,
          items: [
            {
              itemHash: "1",
              name: "纪念",
              itemTypeDisplayName: "机枪",
              groupName: "突袭",
              visible: true,
              unlocked: true,
              failedRequirementIndexes: [],
              requirementCount: 0,
              socketCount: 8
            },
            {
              itemHash: "2",
              name: "信任",
              itemTypeDisplayName: "手炮",
              groupName: "突袭",
              visible: true,
              unlocked: false,
              failedRequirementIndexes: [0],
              requirementCount: 1,
              socketCount: 8
            }
          ]
        }
      ],
      scan: { characterCount: 1, rootNodeHash: "123", note: "test" },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getCatalysts() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      totals: { groups: 1, catalysts: 1, completed: 0, incomplete: 1, visible: 1 },
      groups: [
        {
          key: "power",
          name: "威能武器",
          total: 1,
          completed: 0,
          incomplete: 1,
          items: [
            {
              recordHash: "700",
              weaponHash: "201",
              name: "纪念",
              itemTypeDisplayName: "机枪",
              slot: "power",
              slotLabel: "威能武器",
              completed: false,
              redeemed: false,
              visible: true,
              percent: 50,
              progress: 50,
              completionValue: 100,
              objectives: [{ objectiveHash: "9001", progress: 50, completionValue: 100, complete: false }]
            }
          ]
        }
      ],
      scan: {
        recordDefinitions: 1,
        candidateRecords: 1,
        recordsReturned: 1,
        collectiblesReturned: 1,
        catalystPresentationRecords: 1,
        note: "test"
      },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getPrivateInventory() {
    return {
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      characters: [
        {
          characterId: "2305843009",
          classType: 2,
          className: "术士",
          light: 2010,
          minutesPlayedTotal: 120
        }
      ],
      items: [
        {
          itemHash: 101,
          itemInstanceId: "691752902764",
          quantity: 1,
          owner: "vault",
          name: "纪念",
          itemTypeDisplayName: "机枪",
          bucketName: "威能武器",
          power: 2010,
          locked: true,
          canEquip: true
        }
      ],
      totals: { items: 1, vault: 1, inventory: 0, equipped: 0 },
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async searchPrivateInventory() {
    return {
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      query: "纪念",
      bucket: "all",
      items: [
        {
          itemHash: 101,
          itemInstanceId: "691752902764",
          quantity: 1,
          owner: "vault",
          name: "纪念",
          locked: true,
          canEquip: true
        }
      ],
      total: 1,
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async transferInventoryItem(_membershipType: number, _membershipId: string, _token: string, request: { itemId: string; characterId: string }) {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      action: "transfer",
      ok: true,
      itemId: request.itemId,
      characterId: request.characterId,
      bungieResponse: 1,
      message: "已移动到角色",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async equipInventoryItem(_membershipType: number, _membershipId: string, _token: string, request: { itemId: string; characterId: string }) {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      action: "equip",
      ok: true,
      itemId: request.itemId,
      characterId: request.characterId,
      bungieResponse: 1,
      message: "已装备物品",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async equipInventoryItems(_membershipType: number, _membershipId: string, _token: string, request: { itemIds: string[]; characterId: string }) {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      action: "equipItems",
      ok: true,
      itemIds: request.itemIds,
      characterId: request.characterId,
      bungieResponse: 1,
      message: "已批量装备物品",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async setInventoryItemLockState(_membershipType: number, _membershipId: string, _token: string, request: { itemId: string; characterId: string; state: boolean }) {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      action: "lock",
      ok: true,
      itemId: request.itemId,
      characterId: request.characterId,
      bungieResponse: 1,
      message: request.state ? "已锁定物品" : "已解锁物品",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async getLoadouts() {
    return {
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      characters: [],
      loadouts: [{ index: 0, characterId: "2305843009", name: "Raid", itemCount: 8 }],
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  },
  async equipLoadout(_membershipType: number, _membershipId: string, _token: string, request: { characterId: string; loadoutIndex: number }) {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      action: "equipLoadout",
      ok: true,
      characterId: request.characterId,
      loadoutIndex: request.loadoutIndex,
      bungieResponse: 1,
      message: "已装备游戏内 Loadout",
      updatedAt: "2026-06-03T00:00:00.000Z"
    };
  }
};

const fakeCardService = {
  async renderSummaryCard() {
    return Buffer.from("fake-png");
  },
  async renderProfileCard() {
    return Buffer.from("fake-profile-png");
  },
  async renderWeaponsCard() {
    return Buffer.from("fake-weapons-png");
  },
  async renderRaidOverviewCard() {
    return Buffer.from("fake-raids-png");
  },
  async renderActivityCard() {
    return Buffer.from("fake-png");
  }
};

const fakeBungieClient = {
  async rawRequest(method: string, path: string, options: { query?: unknown }) {
    return {
      url: `https://example.test/Platform${path}`,
      statusCode: 200,
      statusText: "OK",
      contentType: "application/json; charset=utf-8",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {
        Response: {
          method,
          path,
          query: options.query
        },
        ErrorCode: 1,
        ErrorStatus: "Success",
        Message: "Ok",
        ThrottleSeconds: 0
      },
      text: ""
    };
  }
};

const fakeOAuthBungieClient = {
  async get() {
    return {
      destinyMemberships: [
        {
          membershipType: 3,
          membershipId: "4611686018428939884",
          displayName: "SteamName",
          bungieGlobalDisplayName: "Lucifer",
          bungieGlobalDisplayNameCode: 8571
        },
        {
          membershipType: 2,
          membershipId: "4611686018428939885",
          displayName: "PsnName",
          bungieGlobalDisplayName: "Lucifer",
          bungieGlobalDisplayNameCode: 8571
        }
      ]
    };
  }
};

function oauthConfig() {
  return makeTestConfig({
    PUBLIC_BASE_URL: "https://xrx.hitokage.cn",
    BUNGIE_OAUTH_CLIENT_ID: "45756",
    BUNGIE_OAUTH_CLIENT_SECRET: "client-secret",
    BUNGIE_OAUTH_REDIRECT_URL: "https://xrx.hitokage.cn/api/d2/bindings/qq/oauth/callback",
    BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    QQ_BIND_OAUTH_TTL_SECONDS: 180
  });
}

function oauthFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-token",
        refresh_expires_in: 7776000,
        membership_id: "4352344"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
}

describe("Fastify routes", () => {
  it("returns the health envelope", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: { status: "ok" } });
    await app.close();
  });

  it("returns a search result envelope", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({ method: "GET", url: "/api/d2/search?bungieName=Guardian%230007" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        displayName: "Guardian",
        membershipType: 3
      }
    });
    await app.close();
  });

  it("creates and resolves QQ bindings with BungieName input", async () => {
    const store = new NullStore();
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const create = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq",
      payload: { qq: "607972716", bungieName: "Guardian#0007" }
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      success: true,
      data: {
        qq: "607972716",
        membershipType: 3,
        membershipId: "4611686018",
        bungieName: "Guardian#0007"
      }
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq",
      payload: { qq: "607972716", membershipType: 3, membershipId: "4611686019" }
    });
    expect(conflict.statusCode).toBe(400);

    const resolve = await app.inject({ method: "GET", url: "/api/d2/bindings/qq/607972716" });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json()).toMatchObject({
      success: true,
      data: {
        qq: "607972716",
        membershipType: 3,
        membershipId: "4611686018"
      }
    });
    expect(resolve.json().data.lastResolvedAt).toEqual(expect.any(String));
    expect(resolve.json().data.oauth).toBeUndefined();
    await app.close();
  });

  it("returns config errors when QQ OAuth is not configured", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq/oauth/start",
      payload: { qq: "607972716" }
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ success: false, error: { code: "CONFIG_ERROR" } });
    await app.close();
  });

  it("creates QQ bindings through Bungie OAuth callback and confirm", async () => {
    const config = oauthConfig();
    const cache = new MemoryCacheStore();
    const store = new NullStore();
    const qqOAuthService = new QqOAuthService(
      config,
      cache,
      store,
      fakeOAuthBungieClient as never,
      oauthFetch()
    );
    const app = await buildApp({
      config,
      cache,
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      qqOAuthService
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq/oauth/start",
      payload: { qq: "607972716" }
    });
    expect(start.statusCode).toBe(200);
    const bindUrl = start.json().data.bindUrl as string;
    expect(start.json().data.message).toContain("请在3分钟之内访问该链接进行绑定");
    const state = new URL(bindUrl).searchParams.get("state");
    expect(state).toMatch(/^user_bind:/);

    const authorize = await app.inject({
      method: "GET",
      url: `/api/d2/bindings/qq/oauth/authorize?state=${encodeURIComponent(state ?? "")}`
    });
    expect(authorize.statusCode).toBe(302);
    expect(authorize.headers.location).toContain("https://www.bungie.net/en/oauth/authorize");

    const callback = await app.inject({
      method: "GET",
      url: `/api/d2/bindings/qq/oauth/callback?code=test-code&state=${encodeURIComponent(state ?? "")}`
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain("选择要绑定的 Destiny 账号");
    expect(callback.body).toContain("Steam");
    expect(callback.body).toContain("PlayStation");
    expect(callback.body).toContain("4611686018428939884");
    expect(callback.body).not.toContain("3:4611686018428939884");
    const confirmToken = /name="confirmToken" value="([0-9a-f]{64})"/u.exec(callback.body)?.[1];
    expect(confirmToken).toBeTruthy();

    const confirm = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq/oauth/confirm",
      payload: {
        confirmToken,
        membershipType: 3,
        membershipId: "4611686018428939884"
      }
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain("绑定成功");

    const binding = await app.inject({ method: "GET", url: "/api/d2/bindings/qq/607972716" });
    expect(binding.statusCode).toBe(200);
    expect(binding.json()).toMatchObject({
      success: true,
      data: {
        qq: "607972716",
        membershipType: 3,
        membershipId: "4611686018428939884",
        bungieName: "Lucifer#8571"
      }
    });
    expect(binding.json().data.oauth).toBeUndefined();
    const token = await store.getQqOAuthToken("607972716");
    expect(token?.accessTokenEncrypted).not.toContain("access-token");
    expect(token?.refreshTokenEncrypted).not.toContain("refresh-token");
    await app.close();
  });

  it("returns catalyst progress only for the QQ OAuth bound membership", async () => {
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7
    });
    await store.upsertQqOAuthToken({
      qq: "607972716",
      bungieMembershipId: "4352344",
      membershipType: 3,
      membershipId: "4611686018",
      accessTokenEncrypted: "encrypted-access",
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    const qqOAuthService = {
      getValidAccessTokenForQq: vi.fn(async () => "access-token")
    };
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      qqOAuthService: qqOAuthService as never
    });

    const response = await app.inject({ method: "GET", url: "/api/d2/catalysts/qq/607972716" });
    expect(response.statusCode).toBe(200);
    expect(qqOAuthService.getValidAccessTokenForQq).toHaveBeenCalledWith("607972716");
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        totals: { catalysts: 1 },
        groups: [{ key: "power", items: [{ name: "纪念", percent: 50 }] }]
      }
    });
    await app.close();
  });

  it("rejects catalyst progress when QQ OAuth token membership differs from binding", async () => {
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018"
    });
    await store.upsertQqOAuthToken({
      qq: "607972716",
      bungieMembershipId: "4352344",
      membershipType: 3,
      membershipId: "4611686019",
      accessTokenEncrypted: "encrypted-access",
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    const qqOAuthService = {
      getValidAccessTokenForQq: vi.fn(async () => "access-token")
    };
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      qqOAuthService: qqOAuthService as never
    });

    const response = await app.inject({ method: "GET", url: "/api/d2/catalysts/qq/607972716" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ success: false, error: { code: "OAUTH_REQUIRED" } });
    expect(qqOAuthService.getValidAccessTokenForQq).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns private inventory only for the QQ OAuth bound membership", async () => {
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7
    });
    await store.upsertQqOAuthToken({
      qq: "607972716",
      bungieMembershipId: "4352344",
      membershipType: 3,
      membershipId: "4611686018",
      accessTokenEncrypted: "encrypted-access",
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    const qqOAuthService = {
      getValidAccessTokenForQq: vi.fn(async () => "access-token")
    };
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      qqOAuthService: qqOAuthService as never
    });

    const response = await app.inject({ method: "GET", url: "/api/d2/inventory/qq/607972716/search?q=%E7%BA%AA%E5%BF%B5" });
    expect(response.statusCode).toBe(200);
    expect(qqOAuthService.getValidAccessTokenForQq).toHaveBeenCalledWith("607972716");
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        total: 1,
        items: [{ name: "纪念", itemInstanceId: "691752902764" }]
      }
    });
    await app.close();
  });

  it("executes inventory actions through QQ OAuth and writes audit logs", async () => {
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018"
    });
    await store.upsertQqOAuthToken({
      qq: "607972716",
      bungieMembershipId: "4352344",
      membershipType: 3,
      membershipId: "4611686018",
      accessTokenEncrypted: "encrypted-access",
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      qqOAuthService: { getValidAccessTokenForQq: vi.fn(async () => "access-token") } as never
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/d2/inventory/qq/607972716/transfer",
      payload: {
        itemReferenceHash: 101,
        itemId: "691752902764",
        characterId: "2305843009",
        transferToVault: false
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { action: "transfer", itemId: "691752902764", message: "已移动到角色" }
    });
    const audit = await store.listAdminAuditLogs({ page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({
      actor: "qq:607972716",
      action: "inventory.transfer",
      target: "691752902764",
      details: { ok: true, itemId: "691752902764" }
    });
    await app.close();
  });

  it("creates QQ bindings with membership input and returns 404 for missing QQ", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const create = await app.inject({
      method: "POST",
      url: "/api/d2/bindings/qq",
      payload: { qq: "123456", membershipType: 3, membershipId: "4611686018" }
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      success: true,
      data: {
        qq: "123456",
        membershipType: 3,
        membershipId: "4611686018"
      }
    });

    const missing = await app.inject({ method: "GET", url: "/api/d2/bindings/qq/999999" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("returns JSON errors for bad requests", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({ method: "GET", url: "/api/d2/search" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "BAD_REQUEST"
      }
    });
    await app.close();
  });

  it("returns deep raid overview", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/d2/raids/3/4611686018?historyPages=1&pgcrLimit=10"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        totals: { clears: 3 },
        raids: [
          {
            name: "Last Wish",
            clears: 3,
            fastestCompletionDisplay: "30:00.000"
          }
        ]
      }
    });
    await app.close();
  });

  it("returns expanded public stat interfaces", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const career = await app.inject({ method: "GET", url: "/api/d2/career/3/4611686018" });
    const pvp = await app.inject({ method: "GET", url: "/api/d2/pvp/3/4611686018?count=5" });
    const dungeons = await app.inject({ method: "GET", url: "/api/d2/dungeons/3/4611686018?historyPages=1" });
    const grandmasters = await app.inject({
      method: "GET",
      url: "/api/d2/grandmasters/3/4611686018?historyPages=10&pgcrLimit=50&season=current"
    });
    const heatmap = await app.inject({
      method: "GET",
      url: "/api/d2/heatmap/3/4611686018?mode=all&range=all&timezone=Asia%2FShanghai"
    });
    const namecard = await app.inject({ method: "GET", url: "/api/d2/namecard/3/4611686018" });
    const craftables = await app.inject({ method: "GET", url: "/api/d2/craftables/3/4611686018" });

    expect(career.statusCode).toBe(200);
    expect(career.json()).toMatchObject({ success: true, data: { modes: [{ mode: "all" }] } });
    expect(pvp.statusCode).toBe(200);
    expect(pvp.json()).toMatchObject({
      success: true,
      data: {
        weaponScope: expect.any(String),
        aggregates: { matchesScanned: 2 },
        matches: [{ activityName: "Javelin-4" }]
      }
    });
    expect(dungeons.statusCode).toBe(200);
    expect(dungeons.json()).toMatchObject({ success: true, data: { totals: { clears: 2 } } });
    expect(grandmasters.statusCode).toBe(200);
    expect(grandmasters.json()).toMatchObject({
      success: true,
      data: { totals: { lifetimeClears: 5 }, strikes: [{ name: "洞悉终界" }] }
    });
    expect(heatmap.statusCode).toBe(200);
    expect(heatmap.json()).toMatchObject({ success: true, data: { timezone: "Asia/Shanghai", range: "all", calendar: [{ year: 2026 }] } });
    expect(namecard.statusCode).toBe(200);
    expect(namecard.json()).toMatchObject({ success: true, data: { membershipId: "4611686018" } });
    expect(craftables.statusCode).toBe(200);
    expect(craftables.json()).toMatchObject({ success: true, data: { totals: { weapons: 2 }, groups: [{ name: "突袭" }] } });
    await app.close();
  });

  it("returns OAuth-required errors for private Destiny interfaces", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/d2/vault/3/4611686018/search?q=fatebringer"
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "OAUTH_REQUIRED"
      }
    });
    await app.close();
  });

  it("returns image/png for card routes", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/d2/cards/summary.png?bungieName=Guardian%230007"
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBe("fake-png");
    await app.close();
  });

  it("returns card PNGs for QQ, membership, profile, weapons, and latest activity targets", async () => {
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018",
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7
    });
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const summaryByQq = await app.inject({
      method: "GET",
      url: "/api/d2/cards/summary.png?qq=607972716&mode=raid"
    });
    const summaryByMembership = await app.inject({
      method: "GET",
      url: "/api/d2/cards/summary.png?membershipType=3&membershipId=4611686018"
    });
    const profile = await app.inject({
      method: "GET",
      url: "/api/d2/cards/profile.png?qq=607972716"
    });
    const weapons = await app.inject({
      method: "GET",
      url: "/api/d2/cards/weapons.png?membershipType=3&membershipId=4611686018"
    });
    const raids = await app.inject({
      method: "GET",
      url: "/api/d2/cards/raids.png?membershipType=3&membershipId=4611686018"
    });
    const latest = await app.inject({
      method: "GET",
      url: "/api/d2/cards/latest-activity.png?qq=607972716&mode=raid"
    });

    expect(summaryByQq.statusCode).toBe(200);
    expect(summaryByMembership.statusCode).toBe(200);
    expect(profile.statusCode).toBe(200);
    expect(profile.body).toBe("fake-profile-png");
    expect(weapons.statusCode).toBe(200);
    expect(weapons.body).toBe("fake-weapons-png");
    expect(raids.statusCode).toBe(200);
    expect(raids.body).toBe("fake-raids-png");
    expect(latest.statusCode).toBe(200);
    expect(latest.body).toBe("fake-png");
    await app.close();
  });

  it("returns 404 JSON when a card query uses an unbound QQ", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/d2/cards/summary.png?qq=999999"
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "NOT_FOUND"
      }
    });
    await app.close();
  });

  it("proxies public read-only Bungie Platform GET requests", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      bungieClient: fakeBungieClient as never,
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/bungie/Destiny2/Manifest/?lc=zh-chs"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        method: "GET",
        path: "/Destiny2/Manifest/",
        statusCode: 200,
        body: {
          Response: {
            path: "/Destiny2/Manifest/",
            query: { lc: "zh-chs" }
          }
        }
      }
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/bungie/https%3A%2F%2Fevil.test"
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
