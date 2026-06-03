import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";

const COOKIE_NAME = "d2_admin_session";
const HASH_PREFIX = "scrypt";

export interface AdminSession {
  username: string;
  expiresAt: number;
}

export interface AdminAuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
}

export function toAdminAuthConfig(config: AppConfig): AdminAuthConfig {
  return {
    username: config.ADMIN_USERNAME,
    passwordHash: config.ADMIN_PASSWORD_HASH,
    sessionSecret: config.ADMIN_SESSION_SECRET,
    sessionTtlSeconds: config.ADMIN_SESSION_TTL_SECONDS
  };
}

export function isAdminEnabled(config: AdminAuthConfig): boolean {
  return config.username.length > 0 && config.passwordHash.length > 0 && config.sessionSecret.length >= 32;
}

export function hashPassword(password: string): string {
  if (password.length < 8) {
    throw new Error("Admin password must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [prefix, saltText, hashText] = encodedHash.split("$");
  if (prefix !== HASH_PREFIX || !saltText || !hashText) {
    return false;
  }

  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionCookie(username: string, config: AdminAuthConfig, now = Date.now()): string {
  const session: AdminSession = {
    username,
    expiresAt: now + config.sessionTtlSeconds * 1000
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload, config.sessionSecret);
  return `${payload}.${signature}`;
}

export function parseSessionCookie(cookieValue: string | undefined, config: AdminAuthConfig, now = Date.now()): AdminSession | null {
  if (!cookieValue) {
    return null;
  }
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature || sign(payload, config.sessionSecret) !== signature) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (session.username !== config.username || session.expiresAt <= now) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function readSession(request: FastifyRequest, config: AdminAuthConfig): AdminSession | null {
  return parseSessionCookie(parseCookies(request.headers.cookie)[COOKIE_NAME], config);
}

export function setSessionCookie(reply: FastifyReply, value: string, maxAgeSeconds: number): void {
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function requireAdminEnabled(config: AdminAuthConfig): void {
  if (!isAdminEnabled(config)) {
    throw new AppError(503, "CONFIG_ERROR", "Admin dashboard is disabled. Configure ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET.");
  }
}

export function requireAdminSession(request: FastifyRequest, config: AdminAuthConfig): AdminSession {
  requireAdminEnabled(config);
  const session = readSession(request, config);
  if (!session) {
    throw new AppError(401, "UNAUTHORIZED", "Admin login is required");
  }
  return session;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}
