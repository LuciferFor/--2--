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
  async getProfile() {
    return {
      membershipType: 3,
      membershipId: "4611686018",
      profile: { characterIds: [], minutesPlayedTotal: 0 },
      characters: []
    };
  }
};

const fakeManifestService = {
  async refresh() {
    return undefined;
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
});

function firstCookie(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(";")[0] ?? "";
}
