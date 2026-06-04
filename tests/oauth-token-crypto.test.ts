import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/oauth/token-crypto.js";

describe("OAuth token crypto", () => {
  it("encrypts and decrypts tokens with AES-256-GCM", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptToken("secret-access-token", key);
    expect(encrypted).not.toContain("secret-access-token");
    expect(decryptToken(encrypted, key)).toBe("secret-access-token");
  });

  it("rejects invalid encryption keys", () => {
    expect(() => encryptToken("token", Buffer.alloc(16).toString("base64"))).toThrow(/32-byte/);
  });
});
