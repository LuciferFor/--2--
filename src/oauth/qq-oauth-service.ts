import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { CacheStore } from "../cache/cache.js";
import type { QqBindingRecord, QqBindingRow, QqOAuthTokenRow, Store } from "../db/store.js";
import type { BungieClient, BungieEnvelope, FetchLike } from "../destiny/bungie-client.js";
import { BUNGIE_ROOT } from "../destiny/constants.js";
import { parseQq } from "../bindings/qq.js";
import { BadRequestError, ConfigError, OAuthRequiredError, UpstreamError } from "../lib/errors.js";
import { sha256Hex } from "../lib/hash.js";
import { assertValidTokenEncryptionKey, decryptToken, encryptToken } from "./token-crypto.js";

const AUTHORIZE_PATH = "/en/oauth/authorize";
const TOKEN_URL = `${BUNGIE_ROOT}/platform/app/oauth/token/`;

export interface QqOAuthStartResult {
  qq: string;
  state: string;
  bindUrl: string;
  expiresAt: string;
  message: string;
}

export interface QqOAuthCallbackResult {
  qq: string;
  confirmToken: string;
  expiresAt: string;
  memberships: NormalizedDestinyMembership[];
}

export interface NormalizedDestinyMembership {
  membershipType: number;
  membershipId: string;
  displayName: string;
  bungieName?: string;
  displayNameCode?: number;
  iconPath?: string;
}

interface StartState {
  qq: string;
  createdAt: string;
  expiresAt: string;
}

interface ShortBindState {
  state: string;
  createdAt: string;
  expiresAt: string;
}

interface PendingSelection {
  qq: string;
  bungieMembershipId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  accessExpiresAt: string;
  refreshExpiresAt?: string;
  memberships: NormalizedDestinyMembership[];
  createdAt: string;
  expiresAt: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  membership_id: string;
}

interface UserMembershipData {
  destinyMemberships?: Array<Record<string, unknown>>;
}

export class QqOAuthService {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: AppConfig,
    private readonly cache: CacheStore,
    private readonly store: Store,
    private readonly bungieClient: BungieClient,
    fetchImpl: FetchLike = fetch
  ) {
    this.fetchImpl = fetchImpl;
  }

  isConfigured(): boolean {
    return (
      this.config.BUNGIE_OAUTH_CLIENT_ID.trim().length > 0 &&
      this.config.BUNGIE_OAUTH_CLIENT_SECRET.trim().length > 0 &&
      this.redirectUrl().length > 0 &&
      this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY.trim().length > 0
    );
  }

  async startQqBinding(qqInput: unknown): Promise<QqOAuthStartResult> {
    this.assertConfigured();
    const qq = parseQq(qqInput);
    const state = `user_bind:${randomBytes(32).toString("hex")}`;
    const expiresAt = this.expiresAt().toISOString();
    await this.cache.setJson<StartState>(
      this.startKey(state),
      {
        qq,
        createdAt: new Date().toISOString(),
        expiresAt
      },
      this.config.QQ_BIND_OAUTH_TTL_SECONDS
    );

    const shortCode = randomBytes(8).toString("hex");
    await this.cache.setJson<ShortBindState>(
      this.shortBindKey(shortCode),
      {
        state,
        createdAt: new Date().toISOString(),
        expiresAt
      },
      this.config.QQ_BIND_OAUTH_TTL_SECONDS
    );

    const bindUrl = new URL(`/api/d2/bind/${shortCode}`, this.config.PUBLIC_BASE_URL);
    const message = [
      "请在3分钟之内访问该链接进行绑定",
      bindUrl.toString(),
      "",
      "该链接🔗被腾讯标识为危险网站，如果QQ内无法打开请单独复制上述链接文本到外部浏览器进行访问，不要在QQ点开该链接再复制"
    ].join("\n");

    return {
      qq,
      state,
      bindUrl: bindUrl.toString(),
      expiresAt,
      message
    };
  }

  async resolveShortBindCode(codeInput: unknown): Promise<string> {
    const code = typeof codeInput === "string" ? codeInput.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{16}$/u.test(code)) {
      throw new BadRequestError("Invalid OAuth binding link code");
    }
    const stored = await this.cache.getJson<ShortBindState>(this.shortBindKey(code));
    if (!stored) {
      throw new BadRequestError("OAuth binding link is expired or invalid");
    }
    return this.assertStartState(stored.state);
  }

  async assertStartState(stateInput: unknown): Promise<string> {
    const state = this.parseState(stateInput);
    const stored = await this.cache.getJson<StartState>(this.startKey(state));
    if (!stored) {
      throw new BadRequestError("OAuth binding link is expired or invalid");
    }
    return state;
  }

  buildAuthorizeUrl(stateInput: unknown): string {
    this.assertConfigured();
    const state = this.parseState(stateInput);
    const url = new URL(AUTHORIZE_PATH, BUNGIE_ROOT);
    url.searchParams.set("client_id", this.config.BUNGIE_OAUTH_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", this.redirectUrl());
    return url.toString();
  }

  async completeCallback(codeInput: unknown, stateInput: unknown): Promise<QqOAuthCallbackResult> {
    this.assertConfigured();
    const code = typeof codeInput === "string" ? codeInput.trim() : "";
    if (code.length === 0) {
      throw new BadRequestError("OAuth callback code is required");
    }
    const state = this.parseState(stateInput);
    const start = await this.consumeStartState(state);
    const token = await this.exchangeAuthorizationCode(code);
    const membershipData = await this.getMembershipsForCurrentUser(token.access_token);
    const memberships = normalizeDestinyMemberships(membershipData);
    if (memberships.length === 0) {
      throw new BadRequestError("No Destiny membership was returned by Bungie");
    }

    const confirmToken = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = this.expiresAt(now).toISOString();
    await this.cache.setJson<PendingSelection>(
      this.confirmKey(confirmToken),
      {
        qq: start.qq,
        bungieMembershipId: String(token.membership_id),
        accessTokenEncrypted: encryptToken(token.access_token, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY),
        refreshTokenEncrypted: token.refresh_token
          ? encryptToken(token.refresh_token, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY)
          : undefined,
        accessExpiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
        refreshExpiresAt:
          typeof token.refresh_expires_in === "number"
            ? new Date(now.getTime() + token.refresh_expires_in * 1000).toISOString()
            : undefined,
        memberships,
        createdAt: now.toISOString(),
        expiresAt
      },
      this.config.QQ_BIND_OAUTH_TTL_SECONDS
    );

    return {
      qq: start.qq,
      confirmToken,
      expiresAt,
      memberships
    };
  }

  async confirmSelection(confirmTokenInput: unknown, membershipTypeInput: unknown, membershipIdInput: unknown): Promise<QqBindingRow> {
    this.assertConfigured();
    const confirmToken = typeof confirmTokenInput === "string" ? confirmTokenInput.trim() : "";
    const membershipType = Number(membershipTypeInput);
    const membershipId = typeof membershipIdInput === "string" ? membershipIdInput.trim() : String(membershipIdInput ?? "");
    if (!/^[0-9a-f]{64}$/u.test(confirmToken)) {
      throw new BadRequestError("Invalid OAuth confirm token");
    }
    if (!Number.isInteger(membershipType) || membershipType < 1 || membershipType > 254 || !/^[0-9]{8,30}$/u.test(membershipId)) {
      throw new BadRequestError("Invalid Destiny membership selection");
    }

    const pending = await this.cache.getJson<PendingSelection>(this.confirmKey(confirmToken));
    if (!pending) {
      throw new BadRequestError("OAuth confirmation is expired or invalid");
    }
    const selected = pending.memberships.find(
      (membership) => membership.membershipType === membershipType && membership.membershipId === membershipId
    );
    if (!selected) {
      throw new BadRequestError("Selected Destiny membership is not part of this Bungie login");
    }

    const existing = await this.store.getQqBinding(pending.qq);
    if (existing && (existing.membershipType !== membershipType || existing.membershipId !== membershipId)) {
      throw new BadRequestError("qq is already bound to another Destiny membership");
    }

    const binding = membershipToBinding(pending.qq, selected, existing?.notes);
    let saved: QqBindingRow;
    if (existing) {
      saved = await this.store.upsertQqBinding(binding);
    } else {
      const created = await this.store.createQqBinding(binding);
      if (!created) {
        throw new BadRequestError("qq is already bound");
      }
      saved = created;
    }

    await this.store.upsertQqOAuthToken({
      qq: pending.qq,
      bungieMembershipId: pending.bungieMembershipId,
      membershipType,
      membershipId,
      accessTokenEncrypted: pending.accessTokenEncrypted,
      refreshTokenEncrypted: pending.refreshTokenEncrypted,
      accessExpiresAt: pending.accessExpiresAt,
      refreshExpiresAt: pending.refreshExpiresAt
    });
    await this.cache.del(this.confirmKey(confirmToken));
    return saved;
  }

  async getValidAccessTokenForQq(qqInput: unknown): Promise<string> {
    this.assertConfigured();
    const qq = parseQq(qqInput);
    const token = await this.store.getQqOAuthToken(qq);
    if (!token || token.revokedAt) {
      throw new OAuthRequiredError("QQ binding does not have active Bungie OAuth authorization");
    }
    if (new Date(token.accessExpiresAt).getTime() > Date.now() + 60_000) {
      return decryptToken(token.accessTokenEncrypted, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY);
    }
    return this.refreshStoredToken(token);
  }

  private async refreshStoredToken(token: QqOAuthTokenRow): Promise<string> {
    if (!token.refreshTokenEncrypted || (token.refreshExpiresAt && new Date(token.refreshExpiresAt).getTime() <= Date.now())) {
      await this.store.revokeQqOAuthToken(token.qq);
      throw new OAuthRequiredError("Bungie OAuth refresh token is expired; please bind again");
    }

    const refreshToken = decryptToken(token.refreshTokenEncrypted, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY);
    const refreshed = await this.refreshAccessToken(refreshToken);
    const now = new Date();
    const accessTokenEncrypted = encryptToken(refreshed.access_token, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY);
    const refreshTokenEncrypted = refreshed.refresh_token
      ? encryptToken(refreshed.refresh_token, this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY)
      : token.refreshTokenEncrypted;
    await this.store.upsertQqOAuthToken({
      qq: token.qq,
      bungieMembershipId: refreshed.membership_id ? String(refreshed.membership_id) : token.bungieMembershipId,
      membershipType: token.membershipType,
      membershipId: token.membershipId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessExpiresAt: new Date(now.getTime() + refreshed.expires_in * 1000).toISOString(),
      refreshExpiresAt:
        typeof refreshed.refresh_expires_in === "number"
          ? new Date(now.getTime() + refreshed.refresh_expires_in * 1000).toISOString()
          : token.refreshExpiresAt
    });
    return refreshed.access_token;
  }

  private async consumeStartState(state: string): Promise<StartState> {
    const key = this.startKey(state);
    const stored = await this.cache.getJson<StartState>(key);
    await this.cache.del(key);
    if (!stored) {
      throw new BadRequestError("OAuth binding link is expired or invalid");
    }
    return stored;
  }

  private async exchangeAuthorizationCode(code: string): Promise<TokenResponse> {
    return this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUrl()
    });
  }

  private async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
  }

  private async requestToken(body: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.config.BUNGIE_OAUTH_CLIENT_ID}:${this.config.BUNGIE_OAUTH_CLIENT_SECRET}`,
          "utf8"
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams(body).toString()
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      throw new UpstreamError("Bungie OAuth token request failed", {
        status: response.status,
        body: payload ?? text
      });
    }
    return parseTokenResponse(payload);
  }

  private async getMembershipsForCurrentUser(accessToken: string): Promise<UserMembershipData> {
    return this.bungieClient.get<UserMembershipData>("/User/GetMembershipsForCurrentUser/", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ConfigError("Bungie OAuth is not configured");
    }
    assertValidTokenEncryptionKey(this.config.BUNGIE_OAUTH_TOKEN_ENCRYPTION_KEY);
  }

  private redirectUrl(): string {
    return this.config.BUNGIE_OAUTH_REDIRECT_URL.trim() || new URL("/api/d2/bindings/qq/oauth/callback", this.config.PUBLIC_BASE_URL).toString();
  }

  private expiresAt(from: Date = new Date()): Date {
    return new Date(from.getTime() + this.config.QQ_BIND_OAUTH_TTL_SECONDS * 1000);
  }

  private parseState(value: unknown): string {
    const state = typeof value === "string" ? value.trim() : "";
    if (!/^user_bind:[0-9a-f]{64}$/u.test(state)) {
      throw new BadRequestError("Invalid OAuth state");
    }
    return state;
  }

  private startKey(state: string): string {
    return `d2:qq-oauth:start:${sha256Hex(state)}`;
  }

  private shortBindKey(code: string): string {
    return `d2:qq-oauth:short:${sha256Hex(code)}`;
  }

  private confirmKey(confirmToken: string): string {
    return `d2:qq-oauth:confirm:${sha256Hex(confirmToken)}`;
  }
}

export function renderOAuthSelectionHtml(result: QqOAuthCallbackResult): string {
  const rows = result.memberships
    .map((membership) => {
      const label = membership.bungieName ?? membership.displayName;
      const platform = destinyPlatformName(membership.membershipType);
      return `
        <form method="post" action="/api/d2/bindings/qq/oauth/confirm" class="account">
          <input type="hidden" name="confirmToken" value="${escapeHtml(result.confirmToken)}">
          <input type="hidden" name="membershipType" value="${membership.membershipType}">
          <input type="hidden" name="membershipId" value="${escapeHtml(membership.membershipId)}">
          <div>
            <strong>${escapeHtml(platform)}</strong>
            <span>${escapeHtml(label)}</span>
            <span class="account-id">Destiny ID ${escapeHtml(membership.membershipId)}</span>
          </div>
          <button type="submit">绑定这个账号</button>
        </form>
      `;
    })
    .join("");

  return htmlPage(
    "选择要绑定的 Destiny 账号",
    `
      <h1>选择要绑定的 Destiny 账号</h1>
      <p>QQ ${escapeHtml(result.qq)} 已完成 Bungie 登录，请选择机器人以后查询时使用的 Destiny 账号。</p>
      <div class="list">${rows}</div>
      <p class="muted">该确认页将在 ${escapeHtml(new Date(result.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))} 过期。</p>
    `
  );
}

export function renderOAuthResultHtml(title: string, message: string): string {
  return htmlPage(
    title,
    `
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    `
  );
}

function normalizeDestinyMemberships(data: UserMembershipData): NormalizedDestinyMembership[] {
  return (data.destinyMemberships ?? [])
    .map((membership) => {
      const membershipType = Number(membership.membershipType);
      const membershipId = String(membership.membershipId ?? "");
      const displayName = stringValue(membership.bungieGlobalDisplayName) || stringValue(membership.displayName) || `ID ${membershipId.slice(-8)}`;
      const code = Number(membership.bungieGlobalDisplayNameCode ?? 0);
      return {
        membershipType,
        membershipId,
        displayName,
        bungieName: code > 0 ? `${displayName}#${code}` : displayName,
        displayNameCode: code > 0 ? code : undefined,
        iconPath: stringValue(membership.iconPath) || undefined
      };
    })
    .filter((membership) => Number.isInteger(membership.membershipType) && /^[0-9]{8,30}$/u.test(membership.membershipId));
}

function membershipToBinding(qq: string, membership: NormalizedDestinyMembership, notes?: string): QqBindingRecord {
  return {
    qq,
    membershipType: membership.membershipType,
    membershipId: membership.membershipId,
    bungieName: membership.bungieName,
    displayName: membership.displayName,
    displayNameCode: membership.displayNameCode,
    notes
  };
}

function parseTokenResponse(payload: unknown): TokenResponse {
  if (!payload || typeof payload !== "object") {
    throw new UpstreamError("Unexpected Bungie OAuth token response", payload);
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.access_token !== "string" ||
    typeof record.expires_in !== "number" ||
    typeof record.membership_id !== "string"
  ) {
    throw new UpstreamError("Unexpected Bungie OAuth token response", payload);
  }
  return {
    access_token: record.access_token,
    token_type: typeof record.token_type === "string" ? record.token_type : "Bearer",
    expires_in: record.expires_in,
    refresh_token: typeof record.refresh_token === "string" ? record.refresh_token : undefined,
    refresh_expires_in: typeof record.refresh_expires_in === "number" ? record.refresh_expires_in : undefined,
    membership_id: record.membership_id
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function destinyPlatformName(membershipType: number): string {
  const names: Record<number, string> = {
    1: "Xbox",
    2: "PlayStation",
    3: "Steam",
    4: "Battle.net（旧账号）",
    5: "Stadia（旧账号）",
    6: "Epic Games",
    10: "Demon",
    254: "Bungie.net"
  };
  return names[membershipType] ?? `未知平台 ${membershipType}`;
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #151515; color: #f2f2f2; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center; }
    main { width: min(720px, calc(100vw - 32px)); background: #202020; border: 1px solid #383838; border-radius: 8px; padding: 28px; box-sizing: border-box; }
    h1 { margin: 0 0 12px; font-size: 26px; }
    p { color: #c9c9c9; line-height: 1.7; }
    .list { display: grid; gap: 12px; margin-top: 20px; }
    .account { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; background: #181818; border: 1px solid #333; border-radius: 6px; }
    .account strong, .account span { display: block; }
    .account span { margin-top: 4px; color: #9da7b1; font-size: 13px; }
    .account strong { font-size: 18px; }
    .account-id { color: #6f7b86; }
    button { border: 0; border-radius: 4px; padding: 10px 14px; background: #38d996; color: #0f1411; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .muted { color: #8f9ba6; font-size: 13px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
