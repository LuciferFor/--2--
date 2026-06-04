import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/cache/cache.js";
import { makeTestConfig } from "../src/config.js";
import { NullStore } from "../src/db/store.js";
import { QqOAuthService } from "../src/oauth/qq-oauth-service.js";
import { encryptToken } from "../src/oauth/token-crypto.js";

function configured() {
  return makeTestConfig({
    PUBLIC_BASE_URL: "https://xrx.hitokage.cn",
    BUNGIE_OAUTH_CLIENT_ID: "45756",
    BUNGIE_OAUTH_CLIENT_SECRET: "client-secret",
    BUNGIE_OAUTH_REDIRECT_URL: "https://xrx.hitokage.cn/api/d2/bindings/qq/oauth/callback",
    BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64")
  });
}

describe("QQ OAuth service", () => {
  it("refreshes stored access tokens lazily", async () => {
    const config = configured();
    const store = new NullStore();
    await store.createQqBinding({
      qq: "607972716",
      membershipType: 3,
      membershipId: "4611686018428939884"
    });
    await store.upsertQqOAuthToken({
      qq: "607972716",
      bungieMembershipId: "4352344",
      membershipType: 3,
      membershipId: "4611686018428939884",
      accessTokenEncrypted: encryptToken("old-access", config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken("refresh-token", config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY),
      accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 3600_000).toISOString()
    });

    const service = new QqOAuthService(
      config,
      new MemoryCacheStore(),
      store,
      { async get() { return {}; } } as never,
      (async (_url, init) => {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "new-refresh",
            refresh_expires_in: 7776000,
            membership_id: "4352344"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch
    );

    await expect(service.getValidAccessTokenForQq("607972716")).resolves.toBe("new-access");
    const updated = await store.getQqOAuthToken("607972716");
    expect(updated?.accessTokenEncrypted).not.toContain("new-access");
    expect(updated?.refreshTokenEncrypted).not.toContain("new-refresh");
    expect(updated?.revokedAt).toBeUndefined();
  });
});
