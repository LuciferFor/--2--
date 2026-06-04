import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  BUNGIE_API_KEY: z.string().min(1),
  BUNGIE_API_BASE_URL: z.string().url().default("https://www.bungie.net/Platform"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  BUNGIE_OAUTH_CLIENT_ID: z.string().optional().default(""),
  BUNGIE_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  BUNGIE_OAUTH_REDIRECT_URL: z.string().optional().default(""),
  BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY: z.string().optional().default(""),
  QQ_BIND_OAUTH_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DATABASE_URL: z.string().min(1).default("postgres://destiny:destiny@localhost:5432/destiny"),
  MANIFEST_LOCALE: z.string().default("zh-chs"),
  MANIFEST_PRELOAD: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  CARD_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z.string().optional().default(""),
  ADMIN_SESSION_SECRET: z.string().optional().default(""),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400)
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 0,
    BUNGIE_API_KEY: "test-key",
    BUNGIE_API_BASE_URL: "https://example.test/Platform",
    PUBLIC_BASE_URL: "http://localhost:3000",
    BUNGIE_OAUTH_CLIENT_ID: "",
    BUNGIE_OAUTH_CLIENT_SECRET: "",
    BUNGIE_OAUTH_REDIRECT_URL: "",
    BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY: "",
    QQ_BIND_OAUTH_TTL_SECONDS: 180,
    CORS_ORIGIN: "*",
    RATE_LIMIT_MAX: 1000,
    RATE_LIMIT_WINDOW: "1 minute",
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://destiny:destiny@localhost:5432/destiny",
    MANIFEST_LOCALE: "zh-chs",
    MANIFEST_PRELOAD: false,
    CARD_CACHE_TTL_SECONDS: 600,
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: "",
    ADMIN_SESSION_SECRET: "",
    ADMIN_SESSION_TTL_SECONDS: 86400,
    ...overrides
  };
}
