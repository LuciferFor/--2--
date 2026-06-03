import { setTimeout as sleep } from "node:timers/promises";
import type { AppConfig } from "../config.js";
import { BungiePlatformError, UpstreamError } from "../lib/errors.js";

export interface BungieEnvelope<T> {
  Response: T;
  ErrorCode: number;
  ThrottleSeconds: number;
  ErrorStatus: string;
  Message: string;
  MessageData?: Record<string, string>;
  DetailedErrorTrace?: string;
}

export interface BungieRequestOptions {
  query?: Record<string, string | number | boolean | Array<string | number> | undefined>;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  retries?: number;
  timeoutMs?: number;
}

export type FetchLike = typeof fetch;
export type BungieHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface BungieRawResponse {
  url: string;
  statusCode: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  body: unknown;
  text: string;
}

export class BungieClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: Pick<AppConfig, "BUNGIE_API_BASE_URL" | "BUNGIE_API_KEY">, fetchImpl: FetchLike = fetch) {
    this.baseUrl = config.BUNGIE_API_BASE_URL.replace(/\/+$/u, "");
    this.apiKey = config.BUNGIE_API_KEY;
    this.fetchImpl = fetchImpl;
  }

  async get<T>(path: string, options: BungieRequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, options: BungieRequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async request<T>(method: "GET" | "POST", path: string, options: BungieRequestOptions = {}): Promise<T> {
    const raw = await this.rawRequest(method, path, options);
    const payload = raw.body as BungieEnvelope<T> | null;

    if (raw.statusCode < 200 || raw.statusCode >= 300) {
      throw new UpstreamError("Bungie API HTTP error", {
        status: raw.statusCode,
        body: payload ?? raw.text
      });
    }

    if (!payload || typeof payload.ErrorCode !== "number") {
      throw new UpstreamError("Unexpected Bungie API response", payload);
    }

    if (payload.ErrorCode !== 1) {
      throw new BungiePlatformError(
        payload.Message || payload.ErrorStatus || "Bungie API returned an error",
        payload.ErrorCode,
        payload.ErrorStatus,
        payload
      );
    }

    return payload.Response;
  }

  async rawRequest(
    method: BungieHttpMethod,
    path: string,
    options: BungieRequestOptions = {}
  ): Promise<BungieRawResponse> {
    const retries = options.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? 15000;
    const url = this.buildUrl(path, options.query);

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          signal: controller.signal,
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...this.cleanHeaders(options.headers)
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });

        const text = await response.text();

        if (!response.ok) {
          if (attempt < retries && (response.status === 429 || response.status >= 500)) {
            await this.backoff(attempt, response.headers.get("retry-after"));
            continue;
          }
        }

        return {
          url,
          statusCode: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type") ?? "",
          headers: this.responseHeaders(response.headers),
          body: parseBody(text),
          text
        };
      } catch (error) {
        if (attempt < retries && this.shouldRetry(error)) {
          await this.backoff(attempt);
          continue;
        }

        if (error instanceof BungiePlatformError || error instanceof UpstreamError) {
          throw error;
        }

        throw new UpstreamError("Bungie API request failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new UpstreamError("Bungie API request retries exhausted");
  }

  private buildUrl(path: string, query?: BungieRequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) {
        continue;
      }

      const serialized = Array.isArray(value) ? value.join(",") : String(value);
      url.searchParams.set(key, serialized);
    }
    return url.toString();
  }

  private async backoff(attempt: number, retryAfter?: string | null): Promise<void> {
    const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
    const ms = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 250 * 2 ** attempt;
    await sleep(ms);
  }

  private shouldRetry(error: unknown): boolean {
    return error instanceof UpstreamError || (error instanceof Error && error.name === "AbortError");
  }

  private cleanHeaders(headers: BungieRequestOptions["headers"]): Record<string, string> {
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (typeof value === "string" && value.length > 0) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private responseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of ["content-type", "retry-after", "cache-control"]) {
      const value = headers.get(key);
      if (value) {
        result[key] = value;
      }
    }
    return result;
  }
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
