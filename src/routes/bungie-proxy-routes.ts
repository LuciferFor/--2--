import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Store } from "../db/store.js";
import type { BungieClient } from "../destiny/bungie-client.js";
import { BadRequestError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { ok } from "../lib/response.js";

export interface BungieProxyRouteDeps {
  bungieClient: BungieClient;
  store: Store;
}

type Query = Record<string, unknown>;

export async function registerBungieProxyRoutes(app: FastifyInstance, deps: BungieProxyRouteDeps): Promise<void> {
  app.get("/api/bungie/*", async (request) => {
    const started = Date.now();
    const path = platformPathFromUrl(request.url, "/api/bungie");
    const response = await deps.bungieClient.rawRequest("GET", path, {
      query: parseQuery(request.query as Query)
    });

    await recordQuery(deps.store, request, false);
    return ok(
      {
        method: "GET",
        path,
        statusCode: response.statusCode,
        statusText: response.statusText,
        contentType: response.contentType,
        headers: response.headers,
        body: response.body
      },
      { tookMs: Date.now() - started, upstreamUrl: response.url }
    );
  });
}

export function normalizePlatformPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestError("path is required");
  }

  let path = value.trim();
  if (path.length === 0) {
    throw new BadRequestError("path is required");
  }
  if (path.includes("://") || path.startsWith("//")) {
    throw new BadRequestError("Full URLs are not allowed");
  }
  if (path.includes("?")) {
    throw new BadRequestError("Put query parameters in the query object");
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.toLowerCase().startsWith("/platform/")) {
    path = path.slice("/Platform".length);
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path === "/") {
    throw new BadRequestError("A Bungie Platform path is required");
  }
  if (path.includes("\\") || path.includes("..") || /[\u0000-\u001f]/u.test(path)) {
    throw new BadRequestError("Invalid Bungie Platform path");
  }

  return path;
}

export function parseQuery(value: unknown): Record<string, string | number | boolean | Array<string | number>> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new BadRequestError("query must be an object");
  }

  const query: Record<string, string | number | boolean | Array<string | number>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }
    if (Array.isArray(entry)) {
      query[key] = entry.map((item) => {
        const scalar = parseQueryScalar(item, key);
        return typeof scalar === "boolean" ? String(scalar) : scalar;
      });
      continue;
    }
    query[key] = parseQueryScalar(entry, key);
  }
  return query;
}

function platformPathFromUrl(requestUrl: string, prefix: string): string {
  const url = new URL(requestUrl, "http://local");
  const rawPath = decodeURIComponent(url.pathname.slice(prefix.length));
  return normalizePlatformPath(rawPath);
}

function parseQueryScalar(value: unknown, key: string): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new BadRequestError(`Invalid query value for ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function recordQuery(store: Store, request: FastifyRequest, cacheHit: boolean): Promise<void> {
  try {
    await store.logQuery(request.routeOptions.url ?? request.url, cacheHit, sha256Hex(request.ip));
  } catch {
    return;
  }
}
