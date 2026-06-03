import { describe, expect, it } from "vitest";
import {
  createSessionCookie,
  hashPassword,
  isAdminEnabled,
  parseSessionCookie,
  verifyPassword,
  type AdminAuthConfig
} from "../src/admin/auth.js";

const authConfig: AdminAuthConfig = {
  username: "admin",
  passwordHash: "",
  sessionSecret: "test-session-secret-that-is-long-enough",
  sessionTtlSeconds: 60
};

describe("admin auth", () => {
  it("hashes and verifies admin passwords", () => {
    const hash = hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^scrypt:/);
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("still verifies legacy dollar-delimited hashes", () => {
    const legacyHash = hashPassword("correct horse battery staple").replaceAll(":", "$");

    expect(verifyPassword("correct horse battery staple", legacyHash)).toBe(true);
  });

  it("requires a password hash and long session secret before enabling admin", () => {
    expect(isAdminEnabled({ ...authConfig, passwordHash: "scrypt:salt:hash" })).toBe(true);
    expect(isAdminEnabled({ ...authConfig, passwordHash: "" })).toBe(false);
    expect(isAdminEnabled({ ...authConfig, passwordHash: "scrypt:salt:hash", sessionSecret: "short" })).toBe(false);
  });

  it("creates signed sessions and rejects expired or tampered cookies", () => {
    const now = Date.UTC(2026, 5, 3);
    const cookie = createSessionCookie("admin", authConfig, now);

    expect(parseSessionCookie(cookie, authConfig, now + 1000)).toMatchObject({ username: "admin" });
    expect(parseSessionCookie(cookie, authConfig, now + 61_000)).toBeNull();
    expect(parseSessionCookie(`${cookie}x`, authConfig, now + 1000)).toBeNull();
  });
});
