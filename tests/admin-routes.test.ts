import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/admin/auth.js";
import { MemoryCacheStore } from "../src/cache/cache.js";
import { makeTestConfig } from "../src/config.js";
import { NullStore } from "../src/db/store.js";

const adminConfig = makeTestConfig({
  ADMIN_PASSWORD_HASH: hashPassword("admin-password"),
  ADMIN_SESSION_SECRET: "test-admin-session-secret-that-is-long-enough"
});

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
      profile: { characterIds: [], minutesPlayedTotal: 0 },
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
  async getPgcr() {
    return {
      activityId: "123",
      activityName: "Activity",
      players: [],
      teams: []
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

const fakeManifestService = {
  async refresh() {
    return undefined;
  }
};

const fakeBungieClient = {
  async rawRequest(method: string, path: string, options: { query?: unknown; body?: unknown; headers?: Record<string, string> }) {
    return {
      url: `https://example.test/Platform${path}`,
      statusCode: method === "POST" ? 202 : 200,
      statusText: method === "POST" ? "Accepted" : "OK",
      contentType: "application/json; charset=utf-8",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {
        Response: {
          method,
          path,
          query: options.query,
          body: options.body,
          authorization: options.headers?.Authorization ? "present" : "none"
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

describe("admin routes", () => {
  it("returns 503 when admin is not configured", async () => {
    const app = await buildApp({
      config: makeTestConfig(),
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      manifestService: fakeManifestService as never
    });

    const apiResponse = await app.inject({ method: "GET", url: "/api/admin/overview" });
    expect(apiResponse.statusCode).toBe(503);
    expect(apiResponse.json()).toMatchObject({
      success: false,
      error: { code: "CONFIG_ERROR" }
    });

    const logoutResponse = await app.inject({ method: "POST", url: "/api/admin/auth/logout" });
    expect(logoutResponse.statusCode).toBe(503);

    const htmlResponse = await app.inject({ method: "GET", url: "/admin" });
    expect(htmlResponse.statusCode).toBe(200);
    expect(htmlResponse.body).toContain("管理后台未启用");
    await app.close();
  });

  it("protects admin APIs until login succeeds", async () => {
    const app = await buildApp({
      config: adminConfig,
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      manifestService: fakeManifestService as never
    });

    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/overview" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" }
    });

    const badLogin = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "wrong-password" }
    });
    expect(badLogin.statusCode).toBe(400);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(String(cookie)).toContain("d2_admin_session=");

    const me = await app.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: { cookie: firstCookie(cookie) }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ success: true, data: { username: "admin" } });
    await app.close();
  });

  it("returns overview, clears cache, and writes audit logs", async () => {
    const cache = new MemoryCacheStore();
    const store = new NullStore();
    await cache.setJson("d2:summary:3:4611686018:all", { cached: true }, 600);

    const app = await buildApp({
      config: adminConfig,
      cache,
      store,
      destinyService: fakeDestinyService as never,
      manifestService: fakeManifestService as never
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    const cookie = firstCookie(login.headers["set-cookie"]);

    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { cookie }
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      success: true,
      data: {
        dependencies: { redis: "ok", postgres: "ok" },
        admin: { username: "admin" }
      }
    });

    const clear = await app.inject({
      method: "DELETE",
      url: "/api/admin/cache?scope=summary",
      headers: { cookie }
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({ success: true, data: { scope: "summary", deleted: 1 } });
    expect(await cache.getJson("d2:summary:3:4611686018:all")).toBeNull();

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit?pageSize=10",
      headers: { cookie }
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.items.map((row: { action: string }) => row.action)).toContain("cache.clear");
    await app.close();
  });

  it("rejects unsafe admin D2 query proxy requests", async () => {
    const app = await buildApp({
      config: adminConfig,
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      manifestService: fakeManifestService as never
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/admin/d2/query",
      payload: { method: "GET", path: "/api/d2/search", query: { bungieName: "Guardian#0007" } }
    });
    expect(unauthorized.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    const cookie = firstCookie(login.headers["set-cookie"]);

    for (const payload of [
      { method: "POST", path: "/api/d2/search", query: {} },
      { method: "GET", path: "https://www.bungie.net/Platform/Destiny2/Manifest/", query: {} },
      { method: "GET", path: "/health", query: {} },
      { method: "GET", path: "/api/d2/unknown", query: {} },
      { method: "GET", path: "/api/d2/search?bungieName=Guardian%230007", query: {} }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/d2/query",
        headers: { cookie },
        payload
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ success: false, error: { code: "BAD_REQUEST" } });
    }

    await app.close();
  });

  it("proxies allowed D2 JSON and image queries and writes audit logs", async () => {
    const app = await buildApp({
      config: adminConfig,
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      cardService: fakeCardService as never,
      manifestService: fakeManifestService as never
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    const cookie = firstCookie(login.headers["set-cookie"]);

    const jsonResponse = await app.inject({
      method: "POST",
      url: "/api/admin/d2/query",
      headers: { cookie },
      payload: {
        method: "GET",
        path: "/api/d2/search",
        query: { bungieName: "Guardian#0007" }
      }
    });
    expect(jsonResponse.statusCode).toBe(200);
    expect(jsonResponse.json()).toMatchObject({
      success: true,
      data: {
        kind: "json",
        method: "GET",
        url: "/api/d2/search?bungieName=Guardian%230007",
        statusCode: 200,
        body: {
          success: true,
          data: {
            displayName: "Guardian",
            membershipType: 3
          }
        }
      }
    });

    const imageResponse = await app.inject({
      method: "POST",
      url: "/api/admin/d2/query",
      headers: { cookie },
      payload: {
        method: "GET",
        path: "/api/d2/cards/summary.png",
        query: { bungieName: "Guardian#0007" }
      }
    });
    expect(imageResponse.statusCode).toBe(200);
    expect(imageResponse.json()).toMatchObject({
      success: true,
      data: {
        kind: "image",
        statusCode: 200,
        contentType: expect.stringContaining("image/png"),
        bytes: 8,
        base64: Buffer.from("fake-png").toString("base64")
      }
    });

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit?pageSize=20",
      headers: { cookie }
    });
    expect(audit.json().data.items.map((row: { action: string }) => row.action)).toContain("admin.d2.query");
    await app.close();
  });

  it("proxies full Bungie Platform requests from admin APIs and writes audit logs", async () => {
    const app = await buildApp({
      config: adminConfig,
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      bungieClient: fakeBungieClient as never,
      destinyService: fakeDestinyService as never,
      manifestService: fakeManifestService as never
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/admin/bungie/query",
      payload: { method: "GET", path: "/Destiny2/Manifest/" }
    });
    expect(unauthorized.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    const cookie = firstCookie(login.headers["set-cookie"]);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/bungie/query",
      headers: { cookie },
      payload: { method: "GET", path: "https://www.bungie.net/Platform/Destiny2/Manifest/" }
    });
    expect(invalid.statusCode).toBe(400);

    const getResponse = await app.inject({
      method: "POST",
      url: "/api/admin/bungie/query",
      headers: { cookie },
      payload: {
        method: "GET",
        path: "/Platform/Destiny2/Manifest/",
        query: { lc: "zh-chs" }
      }
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      success: true,
      data: {
        kind: "bungie",
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

    const postResponse = await app.inject({
      method: "POST",
      url: "/api/admin/bungie/query",
      headers: { cookie },
      payload: {
        method: "POST",
        path: "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
        body: { displayName: "Guardian", displayNameCode: 7 },
        oauthAccessToken: "test-oauth-token"
      }
    });
    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json()).toMatchObject({
      success: true,
      data: {
        method: "POST",
        statusCode: 202,
        body: {
          Response: {
            body: { displayName: "Guardian", displayNameCode: 7 },
            authorization: "present"
          }
        }
      }
    });

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit?pageSize=20",
      headers: { cookie }
    });
    expect(audit.json().data.items.map((row: { action: string }) => row.action)).toContain("admin.bungie.query");
    await app.close();
  });

  it("manages QQ bindings from admin APIs and writes audit logs", async () => {
    const app = await buildApp({
      config: adminConfig,
      cache: new MemoryCacheStore(),
      store: new NullStore(),
      destinyService: fakeDestinyService as never,
      manifestService: fakeManifestService as never
    });

    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/bindings/qq" });
    expect(unauthorized.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin-password" }
    });
    const cookie = firstCookie(login.headers["set-cookie"]);

    const create = await app.inject({
      method: "POST",
      url: "/api/admin/bindings/qq",
      headers: { cookie },
      payload: { qq: "607972716", bungieName: "Guardian#0007", notes: "test user" }
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      success: true,
      data: {
        qq: "607972716",
        membershipType: 3,
        membershipId: "4611686018",
        notes: "test user"
      }
    });

    const overwrite = await app.inject({
      method: "POST",
      url: "/api/admin/bindings/qq",
      headers: { cookie },
      payload: { qq: "607972716", membershipType: 3, membershipId: "4611686019" }
    });
    expect(overwrite.statusCode).toBe(200);
    expect(overwrite.json()).toMatchObject({
      success: true,
      data: {
        qq: "607972716",
        membershipId: "4611686019"
      }
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/bindings/qq?q=607&pageSize=10",
      headers: { cookie }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      success: true,
      data: {
        total: 1,
        items: [
          {
            qq: "607972716",
            membershipId: "4611686019"
          }
        ]
      }
    });

    const remove = await app.inject({
      method: "DELETE",
      url: "/api/admin/bindings/qq/607972716",
      headers: { cookie }
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({ success: true, data: { qq: "607972716", deleted: true } });

    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit?pageSize=20",
      headers: { cookie }
    });
    const actions = audit.json().data.items.map((row: { action: string }) => row.action);
    expect(actions).toContain("qq.bind.upsert");
    expect(actions).toContain("qq.bind.delete");
    await app.close();
  });
});

function firstCookie(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(";")[0] ?? "";
}
