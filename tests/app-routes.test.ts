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
  async getActivities() {
    return [];
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
  async renderActivityCard() {
    return Buffer.from("fake-png");
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
});
