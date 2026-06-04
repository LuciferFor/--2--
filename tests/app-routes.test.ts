import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryCacheStore } from "../src/cache/cache.js";
import { makeTestConfig } from "../src/config.js";
import { NullStore } from "../src/db/store.js";

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
        clears: 2,
        kills: 50,
        deaths: 5,
        secondsPlayed: 1800
      },
      activities: [
        {
          name: "Duality",
          activityHashes: [2],
          clears: 2,
          completions: 2,
          wins: 2,
          kills: 50,
          deaths: 5,
          secondsPlayed: 1800,
          fastestCompletionDisplay: "15:00.000"
        }
      ],
      scan: {
        historyPages: 1,
        recentActivitiesScanned: 0,
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
      activitiesScanned: 1,
      days: [{ key: "2026-06-03", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 }],
      hours: [{ key: "20", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 }],
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
    const heatmap = await app.inject({
      method: "GET",
      url: "/api/d2/heatmap/3/4611686018?mode=all&pages=1&timezone=Asia%2FShanghai"
    });
    const namecard = await app.inject({ method: "GET", url: "/api/d2/namecard/3/4611686018" });

    expect(career.statusCode).toBe(200);
    expect(career.json()).toMatchObject({ success: true, data: { modes: [{ mode: "all" }] } });
    expect(pvp.statusCode).toBe(200);
    expect(pvp.json()).toMatchObject({ success: true, data: { weaponScope: expect.any(String) } });
    expect(dungeons.statusCode).toBe(200);
    expect(dungeons.json()).toMatchObject({ success: true, data: { totals: { clears: 2 } } });
    expect(heatmap.statusCode).toBe(200);
    expect(heatmap.json()).toMatchObject({ success: true, data: { timezone: "Asia/Shanghai" } });
    expect(namecard.statusCode).toBe(200);
    expect(namecard.json()).toMatchObject({ success: true, data: { membershipId: "4611686018" } });
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
