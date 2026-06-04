import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigError } from "../lib/errors.js";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

export function encryptToken(plainText: string, encodedKey: string): string {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), cipherText.toString("base64")].join(":");
}

export function decryptToken(encrypted: string, encodedKey: string): string {
  const key = decodeEncryptionKey(encodedKey);
  const [version, iv, authTag, cipherText] = encrypted.split(":");
  if (version !== FORMAT_VERSION || !iv || !authTag || !cipherText) {
    throw new ConfigError("Invalid encrypted token format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]).toString("utf8");
}

export function assertValidTokenEncryptionKey(encodedKey: string): void {
  decodeEncryptionKey(encodedKey);
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new ConfigError("BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  }
  return key;
}
