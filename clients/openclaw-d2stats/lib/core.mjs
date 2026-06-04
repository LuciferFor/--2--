import { readFileSync } from "node:fs";

const MODES = new Set(["all", "raid", "dungeon", "trials", "pvp", "gambit"]);
const CARDS = new Set([
  "help",
  "summary",
  "career",
  "profile",
  "namecard",
  "pvp",
  "weapons",
  "raid_overview",
  "dungeon_overview",
  "heatmap",
  "activities",
  "latest_activity",
  "activity",
]);
const CARD_WIDTH = 1200;
const HEATMAP_CARD_WIDTH = 900;
const CJK_FONT_URL = new URL("../assets/NotoSansSC-VF.ttf", import.meta.url).href;
let cachedFontFaceCss;
const imageDataUrlCache = new Map();

const MODE_LABELS = {
  all: "总览",
  raid: "突袭",
  dungeon: "地牢",
  trials: "试炼",
  pvp: "熔炉",
  gambit: "智谋",
};

const ACTIVITY_MODE_LABELS = new Map([
  [5, "全部 PVP"],
  [10, "占领"],
  [12, "冲突"],
  [19, "铁旗"],
  [25, "狂欢"],
  [31, "霸权"],
  [37, "生存"],
  [38, "倒计时"],
  [39, "九之试炼"],
  [48, "混战"],
  [59, "决战"],
  [60, "封锁"],
  [61, "灼烧"],
  [65, "突破"],
  [69, "竞技"],
  [70, "快速比赛"],
  [71, "冲突"],
  [72, "竞技冲突"],
  [73, "占领"],
  [74, "竞技占领"],
  [80, "淘汰"],
  [81, "动量控制"],
  [84, "奥西里斯试炼"],
  [88, "裂隙"],
  [89, "区域控制"],
  [90, "铁旗裂隙"],
  [91, "铁旗区域控制"],
  [92, "圣物"],
  [93, "倒计时突袭"],
  [94, "将死"],
]);

export function resolveConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    baseUrl: String(raw.baseUrl || "http://192.168.31.11:3011").replace(/\/+$/u, ""),
    timeoutMs: clampInteger(raw.timeoutMs, 30000, 1000, 60000),
    defaultCard: CARDS.has(raw.defaultCard) ? raw.defaultCard : "summary",
    defaultMode: MODES.has(raw.defaultMode) ? raw.defaultMode : "all",
    defaultMembershipType: clampInteger(raw.defaultMembershipType, 3, 1, 254),
    logging: raw.logging !== false,
  };
}

export function parseTarget(target, config = resolveConfig()) {
  const value = String(target || "").trim();
  if (!value) {
    throw new D2StatsInputError("请提供 QQ 号、BungieName#1234 或 membershipType:membershipId。");
  }

  const membershipPair = /^([0-9]{1,3})[:/\s]+([0-9]{8,30})$/u.exec(value);
  if (membershipPair) {
    return {
      kind: "membership",
      membershipType: Number(membershipPair[1]),
      membershipId: membershipPair[2],
    };
  }

  if (/^[0-9]{5,15}$/u.test(value)) {
    return { kind: "qq", qq: value };
  }

  if (/^[0-9]{16,30}$/u.test(value)) {
    return {
      kind: "membership",
      membershipType: config.defaultMembershipType,
      membershipId: value,
      assumedMembershipType: true,
    };
  }

  if (/^.+#[0-9]{1,4}$/u.test(value)) {
    return { kind: "bungieName", bungieName: value };
  }

  throw new D2StatsInputError("目标格式不对：请使用 QQ、BungieName#1234 或 membershipType:membershipId。");
}

export function buildPublicDataUrl(kind, target, params = {}, config = resolveConfig()) {
  const query = new URLSearchParams();

  if (kind === "summary") {
    query.set("mode", normalizeMode(params.mode, config.defaultMode));
    return `${config.baseUrl}/api/d2/summary/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "career") {
    return `${config.baseUrl}/api/d2/career/${target.membershipType}/${target.membershipId}`;
  }

  if (kind === "pvp") {
    query.set("count", String(clampInteger(params.count, 50, 1, 50)));
    return `${config.baseUrl}/api/d2/pvp/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "profile") {
    return `${config.baseUrl}/api/d2/profile/${target.membershipType}/${target.membershipId}`;
  }

  if (kind === "namecard") {
    return `${config.baseUrl}/api/d2/namecard/${target.membershipType}/${target.membershipId}`;
  }

  if (kind === "weapons") {
    return `${config.baseUrl}/api/d2/weapons/${target.membershipType}/${target.membershipId}`;
  }

  if (kind === "activities") {
    query.set("mode", normalizeMode(params.mode, config.defaultMode));
    query.set("count", String(clampInteger(params.count, 1, 1, 50)));
    query.set("page", String(clampInteger(params.page, 0, 0, 1000)));
    return `${config.baseUrl}/api/d2/activities/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "raids") {
    query.set("historyPages", String(clampInteger(params.historyPages, 5, 1, 10)));
    query.set("pgcrLimit", String(clampInteger(params.pgcrLimit, 100, 0, 200)));
    return `${config.baseUrl}/api/d2/raids/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "dungeons") {
    query.set("historyPages", String(clampInteger(params.historyPages, 1, 1, 10)));
    return `${config.baseUrl}/api/d2/dungeons/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "heatmap") {
    query.set("mode", normalizeMode(params.mode, config.defaultMode));
    const range = normalizeHeatmapRange(params.range);
    query.set("range", range);
    if (range === "recent") {
      query.set("pages", String(clampInteger(params.pages, 2, 1, 10)));
    }
    if (range === "year" && params.year !== undefined) {
      query.set("year", String(clampInteger(params.year, new Date().getFullYear(), 2017, 2100)));
    }
    query.set("timezone", String(params.timezone || "Asia/Shanghai"));
    return `${config.baseUrl}/api/d2/heatmap/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "pgcr") {
    const activityId = String(params.activityId || params.target || "").trim();
    if (!/^[0-9]+$/u.test(activityId)) {
      throw new D2StatsInputError("查询单局卡片需要提供 activityId。");
    }
    return `${config.baseUrl}/api/d2/pgcr/${activityId}`;
  }

  throw new D2StatsInputError("不支持的数据接口。");
}

export async function queryCard(params = {}, rawConfig = {}, options = {}) {
  const config = resolveConfig(rawConfig);
  if (!config.enabled) {
    return textResult("命运2查询工具当前未启用。", { status: "disabled" });
  }

  let card;
  try {
    card = normalizeCard(params.card || inferCardFromCommand(params.command || params.query), config.defaultCard);
  } catch (error) {
    if (error instanceof D2StatsInputError) {
      return textResult(error.message, { status: "invalid_input" });
    }
    throw error;
  }

  try {
    const rendered = await renderCardFromPublicJson(card, params, config, options);
    const png = await renderHtmlToPng(rendered.html, {
      width: rendered.width,
      height: rendered.height,
      signal: options.signal,
      renderer: options.renderHtmlToPng,
    });

    return imageResult({
      label: `Destiny 2 ${card} card`,
      path: rendered.sourceUrl,
      base64: png.toString("base64"),
      mimeType: "image/png",
      details: {
        status: "ok",
        card,
        bytes: png.length,
        sourceUrl: rendered.sourceUrl,
        renderedBy: "openclaw-html",
      },
    });
  } catch (error) {
    if (error instanceof D2StatsInputError) {
      return textResult(error.message, { status: "invalid_input" });
    }
    if (error instanceof D2StatsBackendError) {
      return textResult(formatBackendError(error.payload, error.status), {
        status: "failed",
        httpStatus: error.status,
        url: error.url,
        error: error.payload,
      });
    }
    return textResult(`命运2卡片渲染失败：${error?.message || "未知错误"}`, {
      status: "render_failed",
      error: String(error?.stack || error),
    });
  }
}

export async function bindQq(params = {}, rawConfig = {}, options = {}) {
  const config = resolveConfig(rawConfig);
  if (!config.enabled) {
    return textResult("命运2查询工具当前未启用。", { status: "disabled" });
  }

  const qq = String(params.qq || "").trim();
  if (!/^[0-9]{5,15}$/u.test(qq)) {
    return textResult("QQ 号格式不对，需要 5 到 15 位数字。", { status: "invalid_input" });
  }

  const body = { qq };
  if (params.bungieName) {
    body.bungieName = String(params.bungieName).trim();
  } else if (params.membershipId) {
    body.membershipType = Number(params.membershipType || config.defaultMembershipType);
    body.membershipId = String(params.membershipId).trim();
  } else if (params.target) {
    const target = parseTarget(params.target, config);
    if (target.kind === "bungieName") {
      body.bungieName = target.bungieName;
    } else if (target.kind === "membership") {
      body.membershipType = target.membershipType;
      body.membershipId = target.membershipId;
    }
  }

  if (!body.bungieName && (!body.membershipType || !body.membershipId)) {
    return startQqOauthBinding(qq, config, options);
  }

  const url = `${config.baseUrl}/api/d2/bindings/qq`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await safeJson(response);

  if (!response.ok || payload?.success === false) {
    return textResult(formatBackendError(payload, response.status), {
      status: "failed",
      httpStatus: response.status,
      error: payload,
    });
  }

  const data = payload.data || {};
  return textResult(`绑定成功：QQ ${data.qq} -> ${data.membershipType}:${data.membershipId}`, {
    status: "ok",
    binding: data,
  });
}

async function renderCardFromPublicJson(card, params, config, options) {
  if (card === "help") {
    return {
      width: CARD_WIDTH,
      height: 880,
      sourceUrl: `${config.baseUrl}/health`,
      html: renderHelpHtml(),
    };
  }

  if (card === "activity") {
    const sourceUrl = buildPublicDataUrl("pgcr", undefined, params, config);
    const pgcr = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 650,
      sourceUrl,
      html: renderActivityHtml(pgcr),
    };
  }

  const resolved = await withCardIdentity(await resolveTargetMembership(params.target, config, options), config, options);

  if (card === "summary") {
    const sourceUrl = buildPublicDataUrl("summary", resolved, params, config);
    const summary = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 620,
      sourceUrl,
      html: renderSummaryHtml(resolved.player, summary),
    };
  }

  if (card === "career") {
    const sourceUrl = buildPublicDataUrl("career", resolved, params, config);
    const career = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 1900,
      sourceUrl,
      html: renderCareerHtml(resolved.player, career),
    };
  }

  if (card === "pvp") {
    const sourceUrl = buildPublicDataUrl("pvp", resolved, params, config);
    const pvp = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 2050,
      sourceUrl,
      html: renderPvpHtml(resolved.player, pvp),
    };
  }

  if (card === "profile") {
    const sourceUrl = buildPublicDataUrl("profile", resolved, params, config);
    const profile = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 650,
      sourceUrl,
      html: renderProfileHtml(resolved.player, profile),
    };
  }

  if (card === "namecard") {
    const sourceUrl = buildPublicDataUrl("namecard", resolved, params, config);
    const namecard = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 640,
      sourceUrl,
      html: renderNamecardHtml(resolved.player, namecard),
    };
  }

  if (card === "weapons") {
    const sourceUrl = buildPublicDataUrl("weapons", resolved, params, config);
    const weapons = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 720,
      sourceUrl,
      html: renderWeaponsHtml(resolved.player, weapons),
    };
  }

  if (card === "activities") {
    const sourceUrl = buildPublicDataUrl("activities", resolved, { ...params, count: params.count || 18, page: params.page || 0 }, config);
    const activities = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 900,
      sourceUrl,
      html: renderActivitiesHtml(resolved.player, activities, params),
    };
  }

  if (card === "latest_activity") {
    const activitiesUrl = buildPublicDataUrl("activities", resolved, { ...params, count: 25, page: 0 }, config);
    const activities = await fetchEnvelope(activitiesUrl, config, options);
    const activity = Array.isArray(activities) ? activities.find(activityCompleted) || activities[0] : undefined;
    if (!activity?.activityId) {
      throw new D2StatsInputError("没有找到最近活动。");
    }
    const sourceUrl = buildPublicDataUrl("pgcr", undefined, { activityId: activity.activityId }, config);
    const pgcr = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 650,
      sourceUrl,
      html: renderActivityHtml(pgcr, resolved.player),
    };
  }

  if (card === "raid_overview") {
    const sourceUrl = buildPublicDataUrl("raids", resolved, params, config);
    const overview = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 2600,
      sourceUrl,
      html: await renderRaidOverviewHtml(resolved.player, overview, config, options),
    };
  }

  if (card === "dungeon_overview") {
    const sourceUrl = buildPublicDataUrl("dungeons", resolved, params, config);
    const overview = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 760,
      sourceUrl,
      html: await renderDungeonOverviewHtml(resolved.player, overview, config, options),
    };
  }

  if (card === "heatmap") {
    const sourceUrl = buildPublicDataUrl("heatmap", resolved, params, config);
    const heatmap = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: HEATMAP_CARD_WIDTH,
      height: estimateHeatmapHeight(heatmap),
      sourceUrl,
      html: renderHeatmapHtml(resolved.player, heatmap),
    };
  }

  throw new D2StatsInputError("不支持的卡片类型。");
}

async function resolveTargetMembership(targetInput, config, options) {
  const target = parseTarget(targetInput, config);

  if (target.kind === "membership") {
    return {
      membershipType: target.membershipType,
      membershipId: target.membershipId,
      player: fallbackPlayer(target.membershipType, target.membershipId),
    };
  }

  if (target.kind === "qq") {
    const url = `${config.baseUrl}/api/d2/bindings/qq/${encodeURIComponent(target.qq)}`;
    let binding;
    try {
      binding = await fetchEnvelope(url, config, options);
    } catch (error) {
      if (error instanceof D2StatsBackendError && error.status === 404) {
        throw new D2StatsInputError(await startQqOauthBindingMessage(target.qq, config, options));
      }
      throw error;
    }
    return {
      membershipType: Number(binding.membershipType),
      membershipId: String(binding.membershipId),
      player: playerFromBinding(binding),
    };
  }

  const url = `${config.baseUrl}/api/d2/search?bungieName=${encodeURIComponent(target.bungieName)}`;
  const player = await fetchEnvelope(url, config, options);
  return {
    membershipType: Number(player.membershipType),
    membershipId: String(player.membershipId),
    player: playerFromSearch(player),
  };
}

async function withCardIdentity(resolved, config, options = {}) {
  try {
    const sourceUrl = buildPublicDataUrl("namecard", resolved, {}, config);
    const namecard = await fetchEnvelope(sourceUrl, config, options);
    return {
      ...resolved,
      player: mergePlayerCardIdentity(resolved.player, namecard),
    };
  } catch {
    return resolved;
  }
}

async function fetchEnvelope(url, config, options = {}) {
  const response = await fetchWithTimeout(url, {
    method: "GET",
    timeoutMs: config.timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  const payload = await safeJson(response);
  if (!response.ok || payload?.success === false) {
    throw new D2StatsBackendError(payload, response.status, url);
  }
  return payload?.data ?? payload;
}

async function startQqOauthBinding(qq, config, options = {}) {
  try {
    const message = await startQqOauthBindingMessage(qq, config, options);
    return textResult(message, {
      status: "oauth_bind_required",
      qq,
    });
  } catch (error) {
    if (error instanceof D2StatsBackendError) {
      return textResult(formatBackendError(error.payload, error.status), {
        status: "failed",
        httpStatus: error.status,
        url: error.url,
        error: error.payload,
      });
    }
    return textResult(`生成绑定链接失败：${error?.message || "未知错误"}`, {
      status: "failed",
      error: String(error?.stack || error),
    });
  }
}

async function startQqOauthBindingMessage(qq, config, options = {}) {
  const url = `${config.baseUrl}/api/d2/bindings/qq/oauth/start`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ qq }),
  });
  const payload = await safeJson(response);
  if (!response.ok || payload?.success === false) {
    throw new D2StatsBackendError(payload, response.status, url);
  }
  const message = payload?.data?.message;
  if (typeof message !== "string" || message.length === 0) {
    throw new D2StatsInputError("后端没有返回绑定链接。");
  }
  return message;
}

async function renderHtmlToPng(html, options = {}) {
  if (typeof options.renderer === "function") {
    return Buffer.from(await options.renderer(html, options));
  }

  let browser;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: options.width || 1100, height: options.height || 720 },
      deviceScaleFactor: 1,
    });
    options.signal?.throwIfAborted?.();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready);
    const card = page.locator("#d2-card");
    return await card.screenshot({ type: "png" });
  } finally {
    await browser?.close();
  }
}

async function loadChromium() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    return require("/app/node_modules/playwright").chromium;
  }
}

function renderSummaryHtml(player, summary) {
  const stats = summary?.stats || {};
  const rows = [
    ["场次", int(stats.activitiesEntered)],
    ["胜场", int(stats.activitiesWon)],
    ["击杀", int(stats.kills)],
    ["死亡", int(stats.deaths)],
    ["助攻", int(stats.assists)],
    ["游玩时长", duration(stats.secondsPlayed)],
  ];
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 PUBLIC STATS",
    subtitle: `${summary?.modeLabel || MODE_LABELS[summary?.mode] || "总览"} · ${dateOnly(summary?.updatedAt)}`,
    body: `
      <section class="metrics metrics-5">
        ${metric("场次", int(stats.activitiesEntered))}
        ${metric("胜率", percent(stats.winRate))}
        ${metric("KD", fixed(stats.kd))}
        ${metric("KDA", fixed(stats.kda))}
        ${metric("效率", fixed(stats.efficiency))}
      </section>
      ${keyValueGrid(rows)}
      ${membershipBlock(summary?.membershipType, summary?.membershipId)}
    `,
  });
}

function renderCareerHtml(player, career) {
  const rows = Array.isArray(career?.modes) ? career.modes : [];
  const seasons = Array.isArray(career?.seasons) ? career.seasons.slice(-21) : [];
  const characters = Array.isArray(career?.characters)
    ? career.characters
    : Array.isArray(career?.profile?.characters)
      ? career.profile.characters
      : [];
  const all = rows.find((item) => item.mode === "all")?.stats || rows[0]?.stats || {};
  const topModes = rows.filter((item) => item.mode !== "all" && Number(item?.stats?.secondsPlayed || 0) > 0).slice(0, 14);
  const primaryCharacter = characters[0] || {};
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 CAREER",
    subtitle: `生涯数据 · ${dateOnly(career?.updatedAt)}`,
    body: `
      <section class="career-hero-strip">
        <div class="career-emblem" style="${careerImageStyle(primaryCharacter?.emblemBackgroundPath || primaryCharacter?.emblemPath)}"></div>
        <div class="career-hero-stats">
          <span>守护者生涯</span>
          <strong>${duration(all.secondsPlayed)}</strong>
          <small>${int(all.activitiesEntered)} 场活动 · ${int(all.kills)} 击杀 · ${characters.length || career?.profile?.profile?.characterIds?.length || 0} 个角色</small>
        </div>
      </section>

      <section class="career-season-panel">
        <div class="career-section-title">赛季档案</div>
        <div class="career-season-grid">
          ${seasons
            .map(
              (season) => `
                <div class="career-season-card ${season?.future ? "future" : ""} ${season?.active ? "active" : ""}">
                  <div class="season-art" style="${careerImageStyle(season?.backgroundImagePath || season?.iconPath)}"></div>
                  <div class="season-meta">
                    <strong>${escapeHtml(season?.name || "未知赛季")}</strong>
                    <span>${season?.durationDays ? `[${int(season.durationDays)}天] ` : ""}${dateOnly(season?.startDate)}${season?.seasonNumber ? ` · S${int(season.seasonNumber)}` : ""}</span>
                  </div>
                  <div class="season-state">${season?.active ? "进行中" : season?.future ? "未开放" : "已归档"}</div>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="career-breakdown-panel">
        <div class="career-account-row">
          <div class="career-character-card total">
            <div class="character-banner" style="${careerImageStyle(primaryCharacter?.emblemBackgroundPath || primaryCharacter?.emblemPath)}"></div>
            <div class="character-summary">
              <strong>总计</strong>
              <span>游玩时长 ${duration(all.secondsPlayed)}</span>
              <span>胜率 ${percent(all.winRate)} · KD ${fixed(all.kd)}</span>
            </div>
          </div>
          <div class="career-chip-grid">
            ${topModes.map((mode) => careerModeChip(mode)).join("")}
          </div>
        </div>

        <div class="career-character-list">
          ${characters
            .slice(0, 3)
            .map((character) => {
              const modeSummaries = Array.isArray(character?.modeSummaries) ? character.modeSummaries : [];
              return `
                <div class="career-account-row character">
                  <div class="career-character-card">
                    <div class="character-banner" style="${careerImageStyle(character?.emblemBackgroundPath || character?.emblemPath)}"></div>
                    <div class="character-summary">
                      <strong>${escapeHtml(displayClassName(character))}</strong>
                      <span>游玩时长 ${duration(character?.totalSecondsPlayed || character?.minutesPlayedTotal * 60)}</span>
                      <span>最后在线 ${dateOnly(character?.dateLastPlayed)}</span>
                    </div>
                  </div>
                  <div class="career-chip-grid">
                    ${modeSummaries
                      .filter((mode) => Number(mode?.stats?.secondsPlayed || 0) > 0)
                      .slice(0, 10)
                      .map((mode) => careerModeChip(mode))
                      .join("")}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="career-table-panel">
        <div class="career-section-title">模式总览</div>
        <div class="career-mode-table">
          ${rows
            .filter((item) => item.mode !== "all")
            .slice(0, 14)
            .map((item) => {
              const stats = item?.stats || {};
              return `
                <div class="career-mode-row">
                  ${careerModeIcon(item?.icon)}
                  <strong>${escapeHtml(item?.modeLabel || item?.mode || "-")}</strong>
                  <span>${compactDuration(stats.secondsPlayed)}</span>
                  <span>${int(stats.activitiesEntered)} 场</span>
                  <span>${compactNumber(stats.kills)} 击杀</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <footer class="card-footer">赛季档案来自 Bungie Manifest；公开接口不提供每赛季精确时长，模式和角色时长来自公开 Historical Stats。</footer>
      ${membershipBlock(career?.membershipType, career?.membershipId)}
    `,
  });
}

function careerModeChip(mode) {
  const stats = mode?.stats || {};
  return `
    <div class="career-mode-chip ${escapeHtml(mode?.tone || "neutral")}">
      ${careerModeIcon(mode?.icon)}
      <div>
        <strong>${escapeHtml(mode?.modeLabel || mode?.mode || "-")}</strong>
        <span>${compactDuration(stats.secondsPlayed)}</span>
      </div>
    </div>
  `;
}

function careerModeIcon(icon) {
  const value = {
    hex: "⬢",
    eye: "◎",
    shield: "▣",
    star: "✦",
    gate: "▥",
    compass: "⌂",
    cross: "×",
    banner: "▰",
    diamond: "◇",
    swirl: "◌",
    spark: "✧",
    moon: "◑",
  }[icon] || "◆";
  return `<span class="career-mode-icon">${escapeHtml(value)}</span>`;
}

function careerImageStyle(path) {
  const url = path ? bungieAssetUrl(path) : "";
  if (!url) {
    return "";
  }
  return `background-image:linear-gradient(90deg, rgba(0,0,0,.18), rgba(0,0,0,.48)), url('${escapeHtml(url)}')`;
}

function renderPvpHtml(player, pvp) {
  const stats = pvp?.summary?.stats || {};
  const trials = pvp?.trials?.stats || {};
  const aggregate = pvp?.aggregates || {};
  const kdPoints = Array.isArray(pvp?.kdComparison) ? pvp.kdComparison.slice(0, 20).reverse() : [];
  const recentWeapons = Array.isArray(pvp?.recentWeapons) ? pvp.recentWeapons.slice(0, 12) : [];
  const matches = Array.isArray(pvp?.matches) ? pvp.matches.slice(0, 18) : [];
  const modes = Array.isArray(pvp?.modeBreakdown) ? pvp.modeBreakdown.slice(0, 4) : [];
  const maxKd = Math.max(1, ...kdPoints.flatMap((item) => [Number(item.playerKd || 0), Number(item.teamKd || 0), Number(item.opponentKd || 0)]));
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 PVP",
    subtitle: `近期 ${int(aggregate.matchesScanned)} 场 PVP · ${dateOnly(pvp?.updatedAt)}`,
    body: `
      <section class="pvp-hero-grid">
        ${pvpHeroMetric("已击败对手", int(stats.kills), "熔炉竞技场 / 职业生涯", "cross")}
        ${pvpHeroMetric("胜场", int(stats.activitiesWon), `胜率 ${percent(stats.winRate)}`, "crown")}
        ${pvpHeroMetric("近期 KD", fixed(aggregate.kd), `${int(aggregate.kills)} / ${int(aggregate.deaths)} / ${int(aggregate.assists)}`, "triangle")}
        ${pvpHeroMetric("试炼 KD", fixed(trials.kd), `试炼胜率 ${percent(trials.winRate)}`, "eye")}
        ${pvpHeroMetric("近期胜场", int(aggregate.wins), `${int(aggregate.wins)} 胜 / ${int(aggregate.losses)} 负`, "cross")}
        ${pvpHeroMetric("最佳击杀", int(aggregate.bestKills), `最佳 KD ${fixed(aggregate.bestKd)}`, "spark")}
        ${pvpHeroMetric("无死场", int(aggregate.flawlessMatches), "近期无死亡且有击杀", "shield")}
        ${pvpHeroMetric("KDA", fixed(aggregate.kda), "近期 KDA", "moon")}
      </section>

      <section class="pvp-panel">
        <h2>近期模式表现</h2>
        <div class="pvp-mode-grid">
          ${modes
            .map(
              (mode) => {
                const modeName = displayActivityModeName(mode.modeName);
                return `
                <div class="pvp-mode-card">
                  <strong>${escapeHtml(modeName || "PVP")}</strong>
                  <span>${int(mode.matches)} 场 · ${int(mode.wins)} 胜</span>
                  <b>${fixed(mode.kd)}</b>
                  <small>KD · 胜率 ${percent(mode.winRate)}</small>
                </div>
              `;
              },
            )
            .join("")}
        </div>
      </section>

      <section class="pvp-panel">
        <h2>玩家近期 20 场 KD 对比柱形图</h2>
        <div class="pvp-chart-legend">
          <span class="blue"></span>玩家 KD <span class="green"></span>队友 KD <span class="red"></span>对手 KD
        </div>
        <div class="pvp-kd-chart">
          ${kdPoints
            .map(
              (point) => `
                <div class="pvp-kd-group">
                  ${pvpBar(point.playerKd, maxKd, "blue")}
                  ${pvpBar(point.teamKd, maxKd, "green")}
                  ${pvpBar(point.opponentKd, maxKd, "red")}
                  <span>${escapeHtml(shortMapName(point.activityName))}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="pvp-panel">
        <h2>玩家近期 50 场武器击杀记录</h2>
        <div class="pvp-weapon-grid">
          ${recentWeapons
            .map(
              (weapon) => `
                <div class="pvp-weapon-tile">
                  ${weaponIconHtml(weapon)}
                  <div>
                    <strong>${escapeHtml(weapon.name || "Unknown")}</strong>
                    <span>${int(weapon.kills)} 击杀 · ${int(weapon.matchesUsed)} 场</span>
                    <small>精准 ${percent(weapon.kills > 0 ? (weapon.precisionKills / weapon.kills) * 100 : 0)}</small>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="pvp-panel">
        <h2>最近比赛</h2>
        <div class="pvp-match-list">
          ${matches
          .map((item) => {
            const modeName = displayActivityModeName(item?.modeName);
            return `
              <div class="pvp-match-row">
                <div class="pvp-match-icon">${pvpModeGlyph(modeName)}</div>
                <div class="pvp-match-main">
                  <strong>${escapeHtml(modeName || "PVP")}</strong>
                  <span>${escapeHtml(item?.activityName || "Unknown")} · ${dateOnly(item?.period)}</span>
                </div>
                <div class="pvp-result ${item?.result === "win" ? "win" : item?.result === "loss" ? "loss" : ""}">
                  ${item?.result === "win" ? "胜利" : item?.result === "loss" ? "失败" : "记录"}
                  <span>${escapeHtml(item?.score || "")}</span>
                </div>
                <div class="pvp-kda"><b>${int(item?.kills)}/${int(item?.deaths)}/${int(item?.assists)}</b><span>KD ${fixed(item?.kd)}</span></div>
                <div class="pvp-match-weapons">
                  ${(Array.isArray(item?.weapons) ? item.weapons.slice(0, 4) : [])
                    .map((weapon) => `<div class="pvp-mini-weapon">${weaponIconHtml(weapon)}<span>${int(weapon.kills)} / ${percent(weapon.precisionRate || 0)}</span></div>`)
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
        </div>
      </section>

      <footer class="card-footer">PVP 详情来自最近 ${int(aggregate.matchesScanned)} 场公开 PGCR；武器命中类百分比使用公开 PGCR 中的精准击杀占比近似。</footer>
    `,
  });
}

function renderNamecardHtml(player, namecard) {
  const profile = namecard?.profile || {};
  const summary = namecard?.summary?.stats || {};
  const characters = Array.isArray(profile?.characters) ? profile.characters.slice(0, 3) : [];
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 NAMECARD",
    subtitle: `名片资料 · ${dateOnly(namecard?.updatedAt)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("最高光等", int(Math.max(0, ...characters.map((item) => Number(item.light || 0)))))}
        ${metric("总时长", duration((profile?.profile?.minutesPlayedTotal || 0) * 60))}
        ${metric("总击杀", int(summary.kills))}
        ${metric("KD", fixed(summary.kd))}
      </section>
      <section class="list">
        ${characters
          .map(
            (item) => `
              <div class="list-row character-row">
                <div>
                  <strong>${escapeHtml(item.className || classLabel(item.classType))}</strong>
                  <span>${escapeHtml(item.characterId || "")}</span>
                </div>
                <div class="big-number">${int(item.light)}</div>
                <div>${duration((item.minutesPlayedTotal || 0) * 60)}</div>
                <div>${dateOnly(item.dateLastPlayed)}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      ${membershipBlock(namecard?.membershipType, namecard?.membershipId)}
    `,
  });
}

function renderHelpHtml() {
  const groups = [
    {
      title: "玩家战绩",
      items: [
        ["/战绩", "总览：场次、胜率、KD、KDA"],
        ["/生涯", "全部 / PVP / 突袭 / 地牢 / 智谋分模式总览"],
        ["/pvp", "PVP 与试炼总览、近期战绩"],
        ["/raid", "突袭总览：每个突袭通关、最快、无暇、Day One"],
        ["/地牢", "地牢总览：每个地牢通关、最快、时长"],
        ["/热力图", "玩家活跃日期与小时分布"],
        ["/活动", "最近活动列表"],
      ],
    },
    {
      title: "单局与列表",
      items: [
        ["/最近", "最近一场活动 PGCR"],
        ["/战绩 activityId", "指定 PGCR 单局详情"],
        ["/武器", "玩家生涯武器击杀统计"],
        ["/资料", "角色、光等、在线时间"],
        ["/名片", "名片资料：角色 + 生涯核心数据"],
        ["/绑定", "QQ -> Bungie ID 自助绑定"],
      ],
    },
    {
      title: "后续补齐",
      items: [
        ["/武器查询", "按武器名查 perk / 推荐组合"],
        ["/perk查询", "按 perk 查数据与武器"],
        ["/仓库搜索", "需要 OAuth 才能看私有仓库"],
        ["/催化", "催化完成情况"],
        ["/称号", "称号/凯旋进度"],
      ],
    },
  ];

  return cardPage({
    eyebrow: "DESTINY 2 COMMANDS",
    title: "命运2查询菜单",
    subtitle: "QQ / BungieName#1234 / membershipType:membershipId 均可作为目标",
    body: `
      <section class="command-grid">
        ${groups
          .map(
            (group) => `
              <div class="command-panel">
                <h2>${escapeHtml(group.title)}</h2>
                ${group.items
                  .map(
                    ([command, description]) => `
                      <div class="command-row">
                        <strong>${escapeHtml(command)}</strong>
                        <span>${escapeHtml(description)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `,
          )
          .join("")}
      </section>
      <section class="notice-panel">
        <strong>当前策略</strong>
        <span>公开接口直接出图；涉及库存、仓库、装备、催化细节和皮肤收藏的能力，需要后续加 OAuth 授权后才完整。</span>
      </section>
    `,
  });
}

function renderActivitiesHtml(player, activities, params) {
  const rows = Array.isArray(activities) ? activities.slice(0, 18) : [];
  const mode = MODE_LABELS[params?.mode] || "最近";
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 ACTIVITY HISTORY",
    subtitle: `${mode}活动 · 最近 ${rows.length} 场`,
    body: `
      <section class="activity-list">
        ${rows
          .map((item) => {
            const values = item?.values || {};
            const completed = Number(values?.completed?.basic?.value || 0) > 0;
            return `
              <div class="activity-card-row">
                <div class="activity-mark">${activityModeIcon(item?.modeName || item?.activityName)}</div>
                <div class="activity-main">
                  <strong>${escapeHtml(item?.activityName || "Unknown Activity")}</strong>
                  <span>${escapeHtml(item?.modeName || "未知模式")} · ${dateOnly(item?.period)}</span>
                  <div class="tag-line">${completed ? pill("已完成", "green") : pill("记录", "muted")} ${pill(`PGCR ${item?.activityId || "-"}`, "muted")}</div>
                </div>
                <div class="activity-stat"><small>击杀</small><b>${int(statValue(values, "kills"))}</b></div>
                <div class="activity-stat"><small>死亡</small><b>${int(statValue(values, "deaths"))}</b></div>
                <div class="activity-stat"><small>KD</small><b>${fixed(statValue(values, "killsDeathsRatio"))}</b></div>
                <div class="activity-stat"><small>时长</small><b>${duration(statValue(values, "activityDurationSeconds"))}</b></div>
              </div>
            `;
          })
          .join("")}
      </section>
    `,
  });
}

function renderProfileHtml(player, profile) {
  const characters = Array.isArray(profile?.characters) ? profile.characters.slice(0, 3) : [];
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 PROFILE",
    subtitle: `角色档案 · ${dateOnly(profile?.profile?.dateLastPlayed)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("角色数", int(profile?.profile?.characterIds?.length || characters.length))}
        ${metric("总时长", duration((profile?.profile?.minutesPlayedTotal || 0) * 60))}
        ${metric("最高光等", int(Math.max(0, ...characters.map((item) => Number(item.light || 0)))))}
        ${metric("最后游玩", dateOnly(profile?.profile?.dateLastPlayed))}
      </section>
      <section class="list">
        ${characters
          .map(
            (item) => `
              <div class="list-row character-row">
                <div>
                  <strong>${escapeHtml(item.className || classLabel(item.classType))}</strong>
                  <span>${escapeHtml(item.characterId || "")}</span>
                </div>
                <div class="big-number">${int(item.light)}</div>
                <div>${duration((item.minutesPlayedTotal || 0) * 60)}</div>
                <div>${dateOnly(item.dateLastPlayed)}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      ${membershipBlock(profile?.membershipType, profile?.membershipId)}
    `,
  });
}

function renderWeaponsHtml(player, weapons) {
  const rows = Array.isArray(weapons?.weapons) ? weapons.weapons.slice(0, 10) : [];
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 WEAPONS",
    subtitle: `武器使用 · ${dateOnly(weapons?.updatedAt)}`,
    body: `
      <section class="table weapon-table">
        <div class="table-head weapon-grid">
          <div>武器</div><div>击杀</div><div>精准</div><div>使用时长</div>
        </div>
        ${rows
          .map(
            (item) => `
              <div class="table-row weapon-grid">
                <div class="name">${escapeHtml(item.name || item.referenceId || "Unknown")}</div>
                <div>${int(item.kills)}</div>
                <div>${int(item.precisionKills)}</div>
                <div>${duration(item.secondsUsed)}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      ${membershipBlock(weapons?.membershipType, weapons?.membershipId)}
    `,
  });
}

function renderActivityHtml(pgcr, player) {
  const players = Array.isArray(pgcr?.players) ? pgcr.players.slice(0, 8) : [];
  return cardPage({
    player,
    title: pgcr?.activityName || `Activity ${pgcr?.activityId || ""}`,
    eyebrow: "DESTINY 2 ACTIVITY",
    subtitle: `${pgcr?.modeName || "单局详情"} · ${dateOnly(pgcr?.period)}`,
    body: `
      <section class="table activity-table">
        <div class="table-head activity-grid">
          <div>玩家</div><div>击杀</div><div>死亡</div><div>助攻</div><div>KD</div><div>完成</div>
        </div>
        ${players
          .map(
            (item) => `
              <div class="table-row activity-grid">
                <div class="name">${escapeHtml(item.displayName || "Unknown")}</div>
                <div>${int(item.kills)}</div>
                <div>${int(item.deaths)}</div>
                <div>${int(item.assists)}</div>
                <div>${fixed(item.kd)}</div>
                <div>${item.completed ? badge("完成", "ok") : badge("未完成", "")}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      <footer class="card-footer">PGCR ${escapeHtml(pgcr?.activityId || "")}</footer>
    `,
  });
}

async function renderRaidOverviewHtml(player, overview, config, options) {
  const rows = Array.isArray(overview?.raids) ? overview.raids : [];
  const totals = overview?.totals || {};
  const bestSpeed = rows
    .filter((item) => Number(item?.fastestCompletionMs || 0) > 0)
    .sort((a, b) => Number(a.fastestCompletionMs || Infinity) - Number(b.fastestCompletionMs || Infinity))[0];
  const rowsWithImages = await Promise.all(
    rows.map(async (item) => ({
      item,
      imageDataUrl: item.pgcrImage ? await imageDataUrl(bungieAssetUrl(item.pgcrImage), config, options) : "",
    })),
  );
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 RAID OVERVIEW",
    subtitle: `突袭总览 · ${dateOnly(overview?.updatedAt)}`,
    body: `
      <section class="raid-rank-row">
        <div class="raid-rank-pill teal">
          <span>Full Clears</span>
          <strong>${int(totals.clears)}</strong>
          <small>${int(totals.completions)} 完成</small>
        </div>
        <div class="raid-rank-pill gold">
          <span>Best Speed</span>
          <strong>${escapeHtml(bestSpeed?.fastestCompletionDisplay || "-")}</strong>
          <small>${escapeHtml(bestSpeed?.displayName || bestSpeed?.name || "暂无")}</small>
        </div>
      </section>
      <section class="raid-detail-list">
        ${rowsWithImages
          .map(
            ({ item, imageDataUrl }) => `
              <div class="raid-detail-row">
                <div class="raid-detail-thumb ${imageDataUrl ? "" : "empty"}">
                  ${imageDataUrl ? `<img src="${escapeHtml(imageDataUrl)}" />` : `<span>${escapeHtml((item.name || "?").slice(0, 2))}</span>`}
                  <b>${escapeHtml(item.displayName || `${item.name || "Unknown"}：${item.difficultyLabel || "普通"}`)}</b>
                </div>
                <div class="raid-tag-stack">
                  ${raidTags(item).join("")}
                </div>
                <div class="raid-stat-pack">${raidProgressMetric("突袭全程次数", item.fullClears ?? item.clears, "blue")}</div>
                <div class="raid-stat-pack">${raidProgressMetric("突袭完成次数", item.completions, "green")}</div>
                <div class="raid-stat-pack">${raidProgressMetric("带队导师次数", raidSherpaDisplay(item), "purple", true)}</div>
                <div class="raid-stat-pack">${raidProgressMetric("全程最短用时", item.fastestCompletionDisplay || "-", "pink", true)}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      <footer class="card-footer">
        全程 / 完成 / 最快来自 Bungie 全量聚合统计；Solo/Trio、无暇、Day One 只能从最近 ${int(overview?.scan?.pgcrScanned)} 场 PGCR 扫描确认；Bungie 官方公开接口不提供全量带队导师次数。
      </footer>
    `,
  });
}

async function renderDungeonOverviewHtml(player, overview, config, options) {
  const rows = Array.isArray(overview?.activities) ? overview.activities.slice(0, 10) : [];
  const totals = overview?.totals || {};
  const rowsWithImages = await Promise.all(
    rows.map(async (item) => ({
      item,
      imageDataUrl: item.pgcrImage ? await imageDataUrl(bungieAssetUrl(item.pgcrImage), config, options) : "",
    })),
  );
  return cardPage({
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 DUNGEON OVERVIEW",
    subtitle: `地牢总览 · ${dateOnly(overview?.updatedAt)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("地牢数", int(totals.activities))}
        ${metric("通关", int(totals.clears))}
        ${metric("击杀", int(totals.kills))}
        ${metric("游玩时长", duration(totals.secondsPlayed))}
      </section>
      <section class="raid-list">
        ${rowsWithImages
          .map(
            ({ item, imageDataUrl }) => `
              <div class="raid-card-row">
                <div class="raid-thumb ${imageDataUrl ? "" : "empty"}">
                  ${imageDataUrl ? `<img src="${escapeHtml(imageDataUrl)}" />` : `<span>${escapeHtml((item.name || "?").slice(0, 2))}</span>`}
                </div>
                <div class="raid-title-block">
                  <strong>${escapeHtml(item.name || "Unknown")}</strong>
                  <span>${pill(`Hash ${item.activityHashes?.[0] || "-"}`, "muted")} ${item.lastClearedAt ? pill(`最近 ${dateOnly(item.lastClearedAt)}`, "green") : pill("近期未扫到", "muted")}</span>
                </div>
                ${raidMetric("通关", int(item.clears), "blue")}
                ${raidMetric("最快", item.fastestCompletionDisplay || "-", "green")}
                ${raidMetric("时长", duration(item.secondsPlayed), "purple")}
                ${raidMetric("击杀", int(item.kills), "red")}
              </div>
            `,
          )
          .join("")}
      </section>
      <footer class="card-footer">通关 / 最快来自 Bungie 全量聚合统计；最近通关来自近 ${int(overview?.scan?.historyPages)} 页公开历史扫描。</footer>
    `,
  });
}

function renderHeatmapHtml(player, heatmap) {
  const days = Array.isArray(heatmap?.days) ? heatmap.days : [];
  const calendar = normalizeHeatmapCalendar(heatmap);
  const totals = sumClientHeatmapBuckets(calendar.map((year) => year.totals));
  const activeDays = days.filter((item) => Number(item.activities || 0) > 0).length;
  const yearLabel =
    heatmap?.range === "year" && heatmap?.year ? `${heatmap.year} 年` : `${calendar[0]?.year || "-"}-${calendar.at(-1)?.year || "-"}`;
  return cardPage({
    width: HEATMAP_CARD_WIDTH,
    player,
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 ACTIVITY HEATMAP",
    subtitle: `${heatmap?.modeLabel || "全部"}活跃 · ${yearLabel} · ${escapeHtml(heatmap?.timezone || "Asia/Shanghai")}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("扫描活动", int(heatmap?.activitiesScanned))}
        ${metric("活跃天数", int(activeDays))}
        ${metric("击杀", compactNumber(totals.kills))}
        ${metric("游玩时长", duration(totals.secondsPlayed))}
      </section>
      <section class="heatmap-legend">
        <span>低活跃</span>
        <i class="heatmap-day i0"></i>
        <i class="heatmap-day i1"></i>
        <i class="heatmap-day i2"></i>
        <i class="heatmap-day i3"></i>
        <i class="heatmap-day i4"></i>
        <span>高活跃</span>
        <b>${escapeHtml(heatmap?.scan?.truncated ? "扫描达到上限，结果可能不完整" : heatmap?.scan?.note || "")}</b>
      </section>
      <section class="heatmap-years">
        ${calendar.map((year) => renderHeatmapYear(year)).join("") || emptyState("没有可显示的公开活动历史。")}
      </section>
      <footer class="card-footer">
        每个格子代表一天；颜色按当天活动数量相对强度计算。扫描 ${int(heatmap?.scan?.pagesPerCharacter)} / ${int(heatmap?.scan?.maxPagesPerCharacter)} 页每角色。
      </footer>
    `,
  });
}

function renderHeatmapYear(year) {
  return `
    <section class="heatmap-year-panel">
      <div class="heatmap-year-title">
        <h2>${escapeHtml(String(year.year))}</h2>
        <span>${int(year.totals?.activities)} 场活动 · ${duration(year.totals?.secondsPlayed)} · ${int(year.totals?.kills)} 击杀</span>
      </div>
      <div class="heatmap-month-grid">
        ${year.months.map((month) => renderHeatmapMonth(month)).join("")}
      </div>
    </section>
  `;
}

function renderHeatmapMonth(month) {
  const placeholders = Array.from({ length: Number(month.firstWeekday || 0) }, () => `<i class="heatmap-day spacer"></i>`).join("");
  return `
    <div class="heatmap-month">
      <div class="heatmap-month-title">
        <strong>${escapeHtml(month.label || `${month.year}年${month.month}月`)}</strong>
        <span>${int(month.totals?.activities)} 场 · ${duration(month.totals?.secondsPlayed)}</span>
      </div>
      <div class="heatmap-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div class="heatmap-calendar-grid">
        ${placeholders}
        ${month.days
          .map(
            (day) =>
              `<i class="heatmap-day i${clampInteger(day.intensity, 0, 0, 4)}" title="${escapeHtml(day.date || day.key)} · ${int(day.activities)} 场"></i>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

function normalizeHeatmapCalendar(heatmap) {
  if (Array.isArray(heatmap?.calendar) && heatmap.calendar.length > 0) {
    return heatmap.calendar;
  }
  const days = Array.isArray(heatmap?.days) ? heatmap.days : [];
  const buckets = new Map(days.map((day) => [day.key, day]));
  const years = [...new Set(days.map((day) => Number(String(day.key || "").slice(0, 4))).filter(Number.isFinite))].sort((a, b) => a - b);
  const maxActivities = Math.max(1, ...days.map((day) => Number(day.activities || 0)));
  return years.map((year) => {
    const months = [...new Set(days
      .filter((day) => Number(String(day.key || "").slice(0, 4)) === year)
      .map((day) => Number(String(day.key || "").slice(5, 7)))
      .filter(Number.isFinite))]
      .sort((a, b) => a - b)
      .map((month) => buildClientHeatmapMonth(year, month, buckets, maxActivities));
    return {
      year,
      totals: sumClientHeatmapBuckets(months.map((month) => month.totals)),
      months,
    };
  });
}

function buildClientHeatmapMonth(year, month, buckets, maxActivities) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = clientMondayWeekday(year, month, 1);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const bucket = buckets.get(date) || emptyClientHeatmapBucket(date);
    return {
      ...bucket,
      date,
      day,
      weekday: clientMondayWeekday(year, month, day),
      week: Math.floor((firstWeekday + index) / 7),
      intensity: clientHeatmapIntensity(Number(bucket.activities || 0), maxActivities),
    };
  });
  return {
    key: `${year}-${pad2(month)}`,
    year,
    month,
    label: `${year}年${month}月`,
    firstWeekday,
    daysInMonth,
    totals: sumClientHeatmapBuckets(days),
    days,
  };
}

function estimateHeatmapHeight(heatmap) {
  const calendar = normalizeHeatmapCalendar(heatmap);
  const yearPanels = calendar.reduce((height, year) => height + 78 + Math.ceil(Math.max(1, year.months.length) / 4) * 214, 0);
  return Math.max(720, 300 + yearPanels);
}

function sumClientHeatmapBuckets(buckets) {
  return buckets.reduce(
    (total, bucket = {}) => ({
      activities: total.activities + Number(bucket.activities || 0),
      completed: total.completed + Number(bucket.completed || 0),
      kills: total.kills + Number(bucket.kills || 0),
      deaths: total.deaths + Number(bucket.deaths || 0),
      secondsPlayed: total.secondsPlayed + Number(bucket.secondsPlayed || 0),
    }),
    emptyClientHeatmapBucket("total"),
  );
}

function emptyClientHeatmapBucket(key) {
  return { key, activities: 0, completed: 0, kills: 0, deaths: 0, secondsPlayed: 0 };
}

function clientHeatmapIntensity(activities, maxActivities) {
  if (activities <= 0) return 0;
  const ratio = activities / Math.max(1, maxActivities);
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function clientMondayWeekday(year, month, day) {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function cardPage({ eyebrow, title, subtitle, body, player, width = CARD_WIDTH }) {
  const headerStyle = playerHeaderStyle(player);
  const emblem = playerEmblemHtml(player);
  const identity = playerIdentityHtml(player);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    ${fontFaceCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body {
      font-family: "D2CJK", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      color: #f5f7fb;
    }
    #d2-card {
      width: ${width}px;
      min-height: 620px;
      padding: 34px 36px 34px;
      background:
        radial-gradient(circle at 8% 0%, rgba(85, 114, 255, 0.18), transparent 28%),
        radial-gradient(circle at 95% 4%, rgba(32, 201, 151, 0.11), transparent 24%),
        linear-gradient(180deg, #202020 0%, #1c1c1c 100%);
      border: 1px solid rgba(255, 255, 255, 0.05);
      position: relative;
      overflow: hidden;
    }
    #d2-card::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.7), transparent 72%);
      pointer-events: none;
    }
    #d2-card::after {
      content: none;
    }
    .content { position: relative; z-index: 1; }
    .header {
      min-height: 144px;
      display: grid;
      grid-template-columns: ${player ? "88px minmax(0, 1fr)" : "minmax(0, 1fr)"};
      gap: 18px;
      align-items: center;
      padding: 18px 22px 20px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      background: rgba(20, 20, 20, 0.78);
      background-size: cover;
      background-position: center;
      border-radius: 8px;
      margin-bottom: 18px;
      overflow: hidden;
      position: relative;
    }
    .header::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(12, 12, 12, 0.92), rgba(12, 12, 12, 0.66) 52%, rgba(12, 12, 12, 0.82));
      pointer-events: none;
    }
    .header > * {
      position: relative;
      z-index: 1;
    }
    .player-emblem {
      width: 76px;
      height: 76px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      background-size: cover;
      background-position: center;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.30);
    }
    .player-emblem.empty {
      display: grid;
      place-items: center;
      color: #8fa3bb;
      font-size: 32px;
      font-weight: 900;
    }
    .eyebrow {
      color: #7db3ff;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0;
      font-size: 54px;
      line-height: 1.05;
      font-weight: 800;
      letter-spacing: 0;
      max-width: 940px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .identity-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin-top: 10px;
      color: #d8e1ec;
      font-size: 15px;
      font-weight: 800;
    }
    .identity-line span {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      padding: 5px 8px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.30);
      border: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subtitle {
      margin-top: 14px;
      color: #b7bec8;
      font-size: 26px;
      line-height: 1.15;
    }
    .subtitle::after {
      content: "";
      display: block;
      width: 198px;
      border-bottom: 3px solid #21d07a;
      margin-top: 10px;
    }
    .metrics {
      display: grid;
      gap: 14px;
      margin-bottom: 18px;
    }
    .metrics-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .metrics-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .pvp-hero-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .pvp-hero-metric {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      min-height: 92px;
      padding: 16px 18px;
      background: rgba(18, 18, 18, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.045);
      border-radius: 8px;
      align-items: center;
    }
    .pvp-hero-icon {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      color: #dfe7f0;
      font-size: 28px;
      line-height: 1;
    }
    .pvp-hero-metric b {
      display: block;
      color: #ffffff;
      font-size: 28px;
      line-height: 1;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pvp-hero-metric strong {
      display: block;
      margin-top: 5px;
      color: #ff5f4c;
      font-size: 16px;
      line-height: 1.1;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pvp-hero-metric span {
      display: block;
      margin-top: 5px;
      color: #a8a8a8;
      font-size: 13px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pvp-panel {
      margin-top: 18px;
      padding: 18px 20px;
      background: rgba(18, 18, 18, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.045);
      border-radius: 8px;
    }
    .pvp-panel h2 {
      margin: 0 0 14px;
      color: #c6c6c6;
      font-size: 22px;
      line-height: 1.2;
      text-align: center;
    }
    .pvp-mode-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .pvp-mode-card {
      min-height: 102px;
      padding: 14px 16px;
      border-radius: 8px;
      background: rgba(10, 10, 10, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.035);
    }
    .pvp-mode-card strong,
    .pvp-mode-card span,
    .pvp-mode-card small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pvp-mode-card strong { font-size: 20px; color: #ffffff; }
    .pvp-mode-card span { margin-top: 5px; font-size: 15px; color: #a8a8a8; }
    .pvp-mode-card b { display: block; margin-top: 7px; font-size: 28px; line-height: 1; color: #21d07a; }
    .pvp-mode-card small { margin-top: 4px; font-size: 13px; color: #a8a8a8; }
    .pvp-chart-legend {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      color: #c8d2de;
      font-size: 16px;
      font-weight: 800;
      margin-bottom: 10px;
    }
    .pvp-chart-legend span {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      display: inline-block;
    }
    .pvp-chart-legend .blue { background: #5667ff; }
    .pvp-chart-legend .green { background: #21d07a; }
    .pvp-chart-legend .red { background: #e55b50; }
    .pvp-kd-chart {
      height: 150px;
      display: grid;
      grid-template-columns: repeat(20, minmax(0, 1fr));
      gap: 8px;
      align-items: end;
      padding: 8px 4px 0;
    }
    .pvp-kd-group {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 2px;
      align-items: end;
      min-width: 0;
    }
    .pvp-kd-group b {
      display: block;
      min-height: 4px;
      border-radius: 3px 3px 0 0;
    }
    .pvp-kd-group b.blue { background: #5667ff; }
    .pvp-kd-group b.green { background: #21d07a; }
    .pvp-kd-group b.red { background: #e55b50; }
    .pvp-kd-group span {
      grid-column: 1 / -1;
      display: block;
      margin-top: 7px;
      color: #a8a8a8;
      font-size: 11px;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pvp-weapon-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px 12px;
    }
    .pvp-weapon-tile {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      min-height: 72px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(10, 10, 10, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.035);
    }
    .weapon-icon {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: 4px;
      background: rgba(255,255,255,0.08);
      display: block;
    }
    .weapon-icon.empty {
      border: 1px solid rgba(255,255,255,0.1);
    }
    .pvp-weapon-tile strong,
    .pvp-weapon-tile span,
    .pvp-weapon-tile small {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pvp-weapon-tile strong { color: #ffffff; font-size: 17px; line-height: 1.15; }
    .pvp-weapon-tile span { color: #c8d2de; font-size: 13px; margin-top: 3px; }
    .pvp-weapon-tile small { color: #21d07a; font-size: 13px; margin-top: 3px; font-weight: 850; }
    .pvp-match-list {
      display: grid;
      gap: 7px;
    }
    .pvp-match-row {
      display: grid;
      grid-template-columns: 50px minmax(0, 1fr) 84px 104px 430px;
      gap: 12px;
      align-items: center;
      min-height: 74px;
      padding: 10px 12px;
      background: rgba(10, 10, 10, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.03);
      border-radius: 7px;
    }
    .pvp-match-icon {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      color: #e5eaf0;
      font-size: 26px;
    }
    .pvp-match-main,
    .pvp-kda,
    .pvp-mini-weapon {
      min-width: 0;
    }
    .pvp-match-main strong {
      display: block;
      color: #ffffff;
      font-size: 19px;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pvp-match-main span,
    .pvp-kda span,
    .pvp-result span,
    .pvp-mini-weapon span {
      display: block;
      color: #a8a8a8;
      font-size: 12px;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pvp-result {
      display: grid;
      align-content: center;
      justify-items: center;
      min-height: 40px;
      border-radius: 4px;
      color: #c8d2de;
      background: rgba(255,255,255,0.08);
      font-size: 15px;
      font-weight: 900;
    }
    .pvp-result.win { color: #ffffff; background: rgba(33, 208, 122, 0.68); }
    .pvp-result.loss { color: #ffffff; background: rgba(229, 91, 80, 0.76); }
    .pvp-kda b {
      display: block;
      color: #ffffff;
      font-size: 18px;
      line-height: 1.1;
      white-space: nowrap;
    }
    .pvp-kda span { color: #21d07a; margin-top: 5px; font-weight: 850; }
    .pvp-match-weapons {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .pvp-mini-weapon {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 6px;
      align-items: center;
    }
    .pvp-mini-weapon .weapon-icon {
      width: 38px;
      height: 38px;
    }
    .pvp-mini-weapon span {
      color: #c8d2de;
      font-size: 11px;
      font-weight: 800;
    }
    .metric {
      min-height: 106px;
      padding: 18px 20px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(16, 16, 16, 0.86);
      border-radius: 8px;
      position: relative;
    }
    .metric::before {
      content: "";
      position: absolute;
      top: -1px;
      left: 16px;
      width: 54px;
      height: 1px;
      background: #21d07a;
    }
    .metric-label {
      color: #a8a8a8;
      font-size: 22px;
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metric-value {
      font-size: 40px;
      line-height: 1;
      font-weight: 850;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metrics-4 .metric-value {
      font-size: 32px;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 80px;
      margin-top: 24px;
      max-width: 820px;
    }
    .kv {
      display: grid;
      grid-template-columns: 150px 1fr;
      align-items: baseline;
      font-size: 28px;
      line-height: 1.32;
    }
    .kv span:first-child { color: #aebdcb; font-weight: 800; }
    .kv span:last-child { font-weight: 800; }
    .table {
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(17, 17, 17, 0.82);
      border-radius: 8px;
      overflow: hidden;
    }
    .table-head,
    .table-row {
      display: grid;
      align-items: center;
      column-gap: 18px;
      padding: 0 20px;
    }
    .table-head {
      min-height: 50px;
      color: #bababa;
      font-size: 23px;
      font-weight: 850;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .table-row {
      min-height: 44px;
      font-size: 23px;
      font-weight: 760;
      border-bottom: 1px solid rgba(255, 255, 255, 0.055);
    }
    .table-row:last-child { border-bottom: 0; }
    .table-row > div,
    .table-head > div {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name {
      color: #ffffff;
      font-weight: 900;
    }
    .weapon-grid { grid-template-columns: minmax(420px, 1fr) 145px 145px 180px; }
    .activity-grid { grid-template-columns: minmax(340px, 1fr) 110px 110px 110px 110px 130px; }
    .career-grid { grid-template-columns: minmax(220px, 1fr) 120px 120px 110px 110px 150px; }
    .career-hero-strip,
    .career-season-panel,
    .career-breakdown-panel,
    .career-table-panel {
      margin-top: 18px;
      background: rgba(18, 18, 18, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      padding: 22px;
    }
    .career-hero-strip {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: 24px;
      align-items: center;
      min-height: 132px;
    }
    .career-emblem,
    .character-banner,
    .season-art {
      background-color: #191919;
      background-position: center;
      background-size: cover;
    }
    .career-emblem {
      height: 96px;
      border-radius: 6px;
    }
    .career-hero-stats span,
    .career-hero-stats small {
      display: block;
      color: #aebdcb;
      font-weight: 800;
    }
    .career-hero-stats strong {
      display: block;
      margin: 2px 0;
      color: #ffffff;
      font-size: 52px;
      line-height: 1;
      font-weight: 950;
    }
    .career-hero-stats small { font-size: 22px; }
    .career-section-title {
      margin-bottom: 16px;
      color: #d8e0ea;
      font-size: 28px;
      font-weight: 950;
      text-align: center;
    }
    .career-season-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .career-season-card {
      position: relative;
      min-height: 138px;
      overflow: hidden;
      border-radius: 8px;
      background: #101010;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }
    .career-season-card.future { opacity: 0.48; }
    .career-season-card.active {
      border-color: rgba(49, 211, 135, 0.72);
      box-shadow: inset 0 0 0 1px rgba(49, 211, 135, 0.26);
    }
    .season-art {
      position: absolute;
      inset: 0;
      opacity: 0.76;
      filter: saturate(0.9) contrast(1.05);
    }
    .season-meta,
    .season-state {
      position: relative;
      z-index: 1;
    }
    .season-meta {
      padding: 18px 18px 0;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
    }
    .season-meta strong {
      display: block;
      overflow: hidden;
      color: #fff;
      font-size: 24px;
      font-weight: 950;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .season-meta span {
      display: block;
      margin-top: 6px;
      color: #d3d8df;
      font-size: 17px;
      font-weight: 850;
    }
    .season-state {
      position: absolute;
      right: 12px;
      bottom: 12px;
      padding: 5px 10px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.5);
      color: #cfd7e2;
      font-size: 16px;
      font-weight: 900;
    }
    .career-account-row {
      display: grid;
      grid-template-columns: 420px 1fr;
      gap: 24px;
      align-items: stretch;
      padding: 18px;
      border-radius: 8px;
      background: rgba(9, 9, 9, 0.66);
    }
    .career-account-row + .career-account-row { margin-top: 16px; }
    .career-character-card {
      display: grid;
      grid-template-rows: 92px 1fr;
      min-height: 174px;
      border-radius: 8px;
      overflow: hidden;
      background: rgba(12, 12, 12, 0.92);
    }
    .character-banner { min-height: 92px; }
    .character-summary {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 14px;
      padding: 16px 18px;
      align-items: center;
    }
    .character-summary strong {
      grid-row: span 2;
      color: #fff;
      font-size: 28px;
      font-weight: 950;
      align-self: center;
    }
    .character-summary span {
      color: #d0d8e2;
      font-size: 20px;
      font-weight: 850;
      white-space: nowrap;
    }
    .career-chip-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-content: center;
    }
    .career-mode-chip {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr);
      gap: 9px;
      align-items: center;
      min-height: 54px;
      padding: 8px 10px;
      border-radius: 5px;
      background: rgba(35, 35, 35, 0.92);
      color: #fff;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.035);
    }
    .career-mode-chip strong,
    .career-mode-chip span {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .career-mode-chip strong { font-size: 17px; font-weight: 950; }
    .career-mode-chip span { color: #eef5ff; font-size: 17px; font-weight: 900; }
    .career-mode-chip.purple { background: linear-gradient(135deg, #4f2d78, #22172c); }
    .career-mode-chip.blue { background: linear-gradient(135deg, #254b86, #172133); }
    .career-mode-chip.teal { background: linear-gradient(135deg, #167b78, #152f31); }
    .career-mode-chip.slate { background: linear-gradient(135deg, #566171, #20242a); }
    .career-mode-chip.gold { background: linear-gradient(135deg, #b07822, #342715); }
    .career-mode-chip.green { background: linear-gradient(135deg, #1d6f4e, #132d22); }
    .career-mode-chip.red { background: linear-gradient(135deg, #963b3b, #351919); }
    .career-mode-chip.gray { background: linear-gradient(135deg, #606060, #242424); }
    .career-mode-chip.dark { background: linear-gradient(135deg, #313131, #151515); }
    .career-mode-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      color: #f6f8fb;
      font-size: 26px;
      font-weight: 900;
      line-height: 1;
    }
    .career-mode-table {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .career-mode-row {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr) 96px 82px 120px;
      align-items: center;
      gap: 8px;
      min-height: 48px;
      padding: 8px 12px;
      border-radius: 5px;
      background: rgba(8, 8, 8, 0.7);
      color: #d9e2ec;
      font-size: 18px;
      font-weight: 850;
    }
    .career-mode-row strong,
    .career-mode-row span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .career-mode-row strong { color: #fff; font-size: 20px; font-weight: 950; }
    .list { display: grid; gap: 12px; }
    .list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 140px 180px 170px;
      align-items: center;
      min-height: 86px;
      padding: 16px 20px;
      border: 1px solid rgba(172, 197, 225, 0.24);
      background: rgba(5, 12, 20, 0.48);
      font-size: 24px;
      font-weight: 760;
    }
    .list-row strong { display: block; font-size: 30px; }
    .list-row span {
      display: block;
      color: #aebdcb;
      font-size: 18px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 500px;
    }
    .big-number { font-size: 42px; font-weight: 900; }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 72px;
      height: 30px;
      padding: 0 10px;
      border: 1px solid rgba(174, 189, 203, 0.36);
      color: #c8d2de;
      font-size: 18px;
      font-weight: 850;
      line-height: 1;
    }
    .badge.ok {
      border-color: rgba(206, 172, 102, 0.86);
      color: #f0d599;
      background: rgba(206, 172, 102, 0.12);
    }
    .membership {
      margin-top: 20px;
      color: #aebdcb;
      font-size: 22px;
      font-weight: 800;
    }
    .membership strong { color: #f5f7fb; }
    .card-footer {
      margin-top: 16px;
      color: #a6a6a6;
      font-size: 18px;
      line-height: 1.35;
    }
    .command-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .command-panel,
    .notice-panel {
      background: rgba(18, 18, 18, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 18px;
    }
    .command-panel h2 {
      margin: 0 0 14px;
      color: #a8a8a8;
      font-size: 24px;
      text-align: center;
    }
    .command-row {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 16px;
      min-height: 54px;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.055);
      font-size: 20px;
    }
    .command-row strong { color: #ffffff; }
    .command-row span { color: #b9b9b9; }
    .notice-panel {
      margin-top: 14px;
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 18px;
      align-items: center;
      font-size: 20px;
      color: #b9b9b9;
    }
    .notice-panel strong { color: #21d07a; font-size: 22px; }
    .activity-list {
      display: grid;
      gap: 8px;
    }
    .activity-card-row {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr) 92px 92px 92px 122px;
      gap: 12px;
      align-items: center;
      min-height: 72px;
      padding: 12px 16px;
      background: rgba(17, 17, 17, 0.86);
      border: 1px solid rgba(255, 255, 255, 0.045);
      border-radius: 8px;
    }
    .activity-mark {
      width: 46px;
      height: 46px;
      display: grid;
      place-items: center;
      border-radius: 6px;
      background: linear-gradient(135deg, #2e3238, #151515);
      color: #ffffff;
      font-size: 26px;
      font-weight: 900;
    }
    .activity-main strong {
      display: block;
      color: #ffffff;
      font-size: 22px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .activity-main span {
      display: block;
      color: #a8a8a8;
      font-size: 16px;
      margin-top: 2px;
    }
    .tag-line { margin-top: 6px; display: flex; gap: 6px; }
    .pill {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 8px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 800;
      color: #cccccc;
      background: rgba(255, 255, 255, 0.08);
    }
    .pill.green { color: #21d07a; background: rgba(33, 208, 122, 0.1); }
    .pill.red { color: #ff675f; background: rgba(255, 103, 95, 0.11); }
    .pill.muted { color: #a8a8a8; }
    .activity-stat {
      text-align: right;
      min-width: 0;
    }
    .activity-stat small {
      display: block;
      color: #8d8d8d;
      font-size: 14px;
      font-weight: 800;
    }
    .activity-stat b {
      display: block;
      color: #ffffff;
      font-size: 22px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
      padding: 12px 16px;
      background: rgba(17, 17, 17, 0.86);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      color: #a8a8a8;
      font-size: 16px;
      font-weight: 800;
    }
    .heatmap-legend b {
      margin-left: auto;
      max-width: 540px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #d7dde6;
      font-weight: 800;
    }
    .heatmap-years {
      display: grid;
      gap: 18px;
    }
    .heatmap-year-panel {
      padding: 20px 22px 22px;
      background: rgba(17, 17, 17, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
    }
    .heatmap-year-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    .heatmap-year-title h2 {
      margin: 0;
      color: #ffffff;
      font-size: 26px;
      line-height: 1.1;
      font-weight: 950;
    }
    .heatmap-year-title span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #aeb7c2;
      font-size: 16px;
      font-weight: 850;
    }
    .heatmap-month-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 18px;
    }
    .heatmap-month {
      min-height: 194px;
      padding: 14px 14px 16px;
      background: rgba(10, 10, 10, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.035);
      border-radius: 8px;
    }
    .heatmap-month-title {
      display: grid;
      gap: 4px;
      margin-bottom: 10px;
      text-align: center;
    }
    .heatmap-month-title strong,
    .heatmap-month-title span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .heatmap-month-title strong {
      color: #ffffff;
      font-size: 18px;
      font-weight: 950;
    }
    .heatmap-month-title span {
      color: #8d98a6;
      font-size: 12px;
      font-weight: 800;
    }
    .heatmap-weekdays,
    .heatmap-calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }
    .heatmap-weekdays {
      margin-bottom: 6px;
      color: #777f89;
      font-size: 11px;
      font-weight: 900;
      text-align: center;
    }
    .heatmap-day {
      display: block;
      aspect-ratio: 1 / 1;
      min-width: 0;
      border-radius: 3px;
      background: #2a2a2a;
      border: 1px solid rgba(255, 255, 255, 0.025);
    }
    .heatmap-day.spacer {
      background: transparent;
      border-color: transparent;
    }
    .heatmap-day.i0 { background: #2b2b2b; }
    .heatmap-day.i1 { background: #3767d6; }
    .heatmap-day.i2 { background: #2fcb82; }
    .heatmap-day.i3 { background: #ff8a3d; }
    .heatmap-day.i4 { background: #ffd0a4; box-shadow: 0 0 12px rgba(255, 138, 61, 0.42); }
    .empty-state {
      min-height: 180px;
      display: grid;
      place-items: center;
      color: #aeb7c2;
      font-size: 22px;
      font-weight: 900;
      background: rgba(17, 17, 17, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
    }
    .raid-rank-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 22px;
      margin: -6px 0 20px;
    }
    .raid-rank-pill {
      min-height: 88px;
      border-radius: 12px;
      padding: 14px 22px;
      text-align: center;
      color: #fff;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.14);
    }
    .raid-rank-pill.teal { background: linear-gradient(135deg, #11b8af, #16766c); }
    .raid-rank-pill.gold { background: linear-gradient(135deg, #ffc84d, #b17827); }
    .raid-rank-pill span,
    .raid-rank-pill small {
      display: block;
      font-size: 17px;
      font-weight: 850;
      opacity: .95;
    }
    .raid-rank-pill strong {
      display: block;
      margin: 3px 0;
      font-size: 30px;
      font-weight: 950;
      line-height: 1;
    }
    .raid-detail-list {
      display: grid;
      gap: 18px;
    }
    .raid-detail-row {
      display: grid;
      grid-template-columns: 230px 156px repeat(4, minmax(0, 1fr));
      gap: 18px;
      align-items: center;
      min-height: 142px;
      padding: 18px 22px;
      border-radius: 10px;
      background: rgba(17, 17, 17, 0.9);
      border: 1px solid rgba(255,255,255,.035);
    }
    .raid-detail-thumb {
      position: relative;
      width: 230px;
      height: 96px;
      overflow: hidden;
      border-radius: 9px;
      background: #171717;
    }
    .raid-detail-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: saturate(1.04) contrast(1.05);
    }
    .raid-detail-thumb::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(0,0,0,.56), rgba(0,0,0,.08));
    }
    .raid-detail-thumb b {
      position: absolute;
      z-index: 1;
      left: 14px;
      top: 12px;
      right: 12px;
      color: #fff;
      font-size: 20px;
      font-weight: 950;
      line-height: 1.18;
      text-shadow: 0 2px 10px rgba(0,0,0,.95);
    }
    .raid-detail-thumb.empty {
      display: grid;
      place-items: center;
      color: #fff;
      font-size: 26px;
      font-weight: 950;
    }
    .raid-tag-stack {
      display: flex;
      flex-wrap: wrap;
      align-content: center;
      gap: 8px;
      min-height: 70px;
    }
    .raid-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 4px;
      background: rgba(255,255,255,.1);
      color: #e6edf7;
      font-size: 16px;
      font-weight: 950;
      white-space: nowrap;
    }
    .raid-tag.dayone { background: #ba49bd; }
    .raid-tag.flawless { background: #d14f5f; }
    .raid-tag.solo { background: #4c69e8; }
    .raid-tag.duo { background: #8557f1; }
    .raid-tag.trio { background: #ff9f2f; }
    .raid-tag.muted { background: transparent; color: #88939f; border: 1px solid rgba(255,255,255,.08); }
    .raid-progress-metric {
      min-width: 0;
      text-align: right;
    }
    .raid-progress-metric span {
      display: block;
      color: #c3ccd7;
      font-size: 16px;
      font-weight: 850;
      white-space: nowrap;
    }
    .raid-progress-metric i {
      display: block;
      width: 112px;
      height: 6px;
      margin: 8px 0 8px auto;
      border-radius: 999px;
      background: #6475ff;
    }
    .raid-progress-metric.green i { background: #42c894; }
    .raid-progress-metric.purple i { background: #a95ad0; }
    .raid-progress-metric.pink i { background: #ff6986; }
    .raid-progress-metric strong {
      display: block;
      color: #fff;
      font-size: 28px;
      font-weight: 950;
      line-height: 1.05;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .raid-list {
      display: grid;
      gap: 12px;
    }
    .raid-card-row {
      display: grid;
      grid-template-columns: 214px minmax(0, 1.2fr) 128px 154px 146px 146px;
      gap: 18px;
      align-items: center;
      min-height: 116px;
      padding: 14px 18px;
      background: rgba(17, 17, 17, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.045);
      border-radius: 8px;
    }
    .raid-thumb {
      width: 214px;
      height: 86px;
      border-radius: 8px;
      overflow: hidden;
      background: linear-gradient(135deg, #2f3741, #111111);
      position: relative;
    }
    .raid-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: saturate(1.05) contrast(1.04);
    }
    .raid-thumb::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(0,0,0,0.38), transparent 68%);
    }
    .raid-thumb.empty {
      display: grid;
      place-items: center;
      color: #ffffff;
      font-size: 30px;
      font-weight: 900;
    }
    .raid-title-block {
      min-width: 0;
    }
    .raid-title-block strong {
      display: block;
      color: #ffffff;
      font-size: 25px;
      font-weight: 900;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .raid-title-block span {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .raid-mini-metric {
      min-width: 0;
      text-align: right;
    }
    .raid-mini-metric small {
      color: #a6a6a6;
      font-size: 15px;
      font-weight: 800;
    }
    .raid-mini-metric .metric-bar {
      height: 5px;
      margin: 7px 0 8px auto;
      width: 96px;
      border-radius: 999px;
      background: #6b7cff;
    }
    .raid-mini-metric.green .metric-bar { background: #2ec988; }
    .raid-mini-metric.purple .metric-bar { background: #b45ad8; }
    .raid-mini-metric.red .metric-bar { background: #ff6675; }
    .raid-mini-metric b {
      display: block;
      color: #ffffff;
      font-size: 25px;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <main id="d2-card">
    <div class="content">
      <header class="header" style="${headerStyle}">
        ${emblem}
        <div class="header-main">
          <div class="eyebrow">${escapeHtml(eyebrow)}</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="subtitle">${escapeHtml(subtitle)}</div>
          ${identity}
        </div>
      </header>
      ${body}
    </div>
  </main>
</body>
</html>`;
}

function playerHeaderStyle(player) {
  const url = player?.emblemBackgroundPath ? bungieAssetUrl(player.emblemBackgroundPath) : "";
  if (!url) {
    return "";
  }
  return `background-image:url('${escapeHtml(url)}')`;
}

function playerEmblemHtml(player) {
  if (!player) {
    return "";
  }
  const url = player?.emblemPath ? bungieAssetUrl(player.emblemPath) : "";
  if (!url) {
    return `<div class="player-emblem empty">${escapeHtml(playerInitial(player))}</div>`;
  }
  return `<div class="player-emblem" style="background-image:url('${escapeHtml(url)}')"></div>`;
}

function playerIdentityHtml(player) {
  if (!player) {
    return "";
  }
  const membership = playerMembershipId(player);
  const details = [
    membership ? `ID ${membership}` : "",
    player.currentClassName && player.currentLight ? `${player.currentClassName} ${int(player.currentLight)}光` : "",
    player.lastPlayedAt ? `最后在线 ${dateOnly(player.lastPlayedAt)}` : "",
  ].filter(Boolean);
  if (details.length === 0) {
    return "";
  }
  return `<div class="identity-line">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function playerMembershipId(player) {
  if (!player?.membershipType || !player?.membershipId) {
    return "";
  }
  return `${player.membershipType}:${player.membershipId}`;
}

function playerInitial(player) {
  const name = formatPlayerName(player);
  return name.slice(0, 1).toUpperCase() || "G";
}

function fontFaceCss() {
  if (cachedFontFaceCss !== undefined) {
    return cachedFontFaceCss;
  }
  try {
    const base64 = readFileSync(new URL("../assets/NotoSansSC-VF.ttf", import.meta.url)).toString("base64");
    cachedFontFaceCss = `
      @font-face {
        font-family: "D2CJK";
        src: url("data:font/ttf;base64,${base64}") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: block;
      }
    `;
  } catch {
    cachedFontFaceCss = `
      @font-face {
        font-family: "D2CJK";
        src: url("${CJK_FONT_URL}") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: block;
      }
    `;
  }
  return cachedFontFaceCss;
}

function metric(label, value) {
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(String(value))}</div>
    </div>
  `;
}

function pvpHeroMetric(label, value, note, icon) {
  return `
    <div class="pvp-hero-metric">
      <div class="pvp-hero-icon">${escapeHtml(pvpIconGlyph(icon))}</div>
      <div>
        <b>${escapeHtml(String(value))}</b>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(note)}</span>
      </div>
    </div>
  `;
}

function pvpBar(value, max, tone) {
  const height = Math.max(4, Math.round((Number(value || 0) / Math.max(1, max)) * 94));
  return `<b class="${tone}" style="height:${height}px"></b>`;
}

function weaponIconHtml(weapon) {
  const url = weapon?.iconPath ? bungieAssetUrl(weapon.iconPath) : "";
  if (!url) {
    return `<span class="weapon-icon empty"></span>`;
  }
  return `<img class="weapon-icon" src="${escapeHtml(url)}" />`;
}

function shortMapName(value) {
  const text = String(value || "-");
  return text.length > 5 ? text.slice(0, 5) : text;
}

function displayActivityModeName(value) {
  const text = String(value || "").trim();
  const modeMatch = /^Mode\s+([0-9]+)$/iu.exec(text);
  if (modeMatch) {
    return ACTIVITY_MODE_LABELS.get(Number(modeMatch[1])) || text;
  }
  if (/^[0-9]+$/u.test(text)) {
    return ACTIVITY_MODE_LABELS.get(Number(text)) || `Mode ${text}`;
  }
  return text;
}

function pvpModeGlyph(value) {
  const text = String(value || "").toLowerCase();
  if (/trial|试炼|osiris/u.test(text)) return "◎";
  if (/rumble|混战/u.test(text)) return "◇";
  if (/control|占领/u.test(text)) return "×";
  if (/competitive|竞技|survival|生存/u.test(text)) return "△";
  return "×";
}

function pvpIconGlyph(value) {
  switch (value) {
    case "crown":
      return "♛";
    case "triangle":
      return "△";
    case "eye":
      return "◎";
    case "spark":
      return "✦";
    case "shield":
      return "▣";
    case "moon":
      return "◑";
    default:
      return "×";
  }
}

function keyValueGrid(rows) {
  return `
    <section class="kv-grid">
      ${rows.map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><span>${escapeHtml(String(value))}</span></div>`).join("")}
    </section>
  `;
}

function membershipBlock(membershipType, membershipId) {
  if (!membershipType || !membershipId) {
    return "";
  }
  return `<div class="membership">Membership <strong>${escapeHtml(`${membershipType}:${membershipId}`)}</strong></div>`;
}

function statusBadge(status, confirmedLabel = "确认") {
  if (status === "confirmed") {
    return badge(confirmedLabel, "ok");
  }
  if (status === "not_found_in_scanned_pgcr") {
    return badge("未发现", "");
  }
  return badge("未知", "");
}

function badge(label, tone) {
  return `<span class="badge ${tone === "ok" ? "ok" : ""}">${escapeHtml(label)}</span>`;
}

function raidMetric(label, value, tone) {
  return `
    <div class="raid-mini-metric ${tone}">
      <small>${escapeHtml(label)}</small>
      <div class="metric-bar"></div>
      <b>${escapeHtml(String(value))}</b>
    </div>
  `;
}

function raidProgressMetric(label, value, tone, raw = false) {
  const display = raw ? String(value || "-") : int(value);
  return `
    <div class="raid-progress-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <i></i>
      <strong>${escapeHtml(display)}</strong>
    </div>
  `;
}

function raidSherpaDisplay(item) {
  const value = Number(item?.sherpaCompletions || 0);
  return value > 0 ? int(value) : "未公开";
}

function raidTags(item) {
  const tags = [];
  if (item?.dayOne?.status === "confirmed") {
    tags.push(`<span class="raid-tag dayone">DayOne</span>`);
  }
  if (item?.flawless?.status === "confirmed") {
    tags.push(`<span class="raid-tag flawless">无暇</span>`);
  }
  const fireteamSizes = item?.fireteamSizes || {};
  if (Number(fireteamSizes.solo || 0) > 0) {
    tags.push(`<span class="raid-tag solo">Solo</span>`);
  }
  if (Number(fireteamSizes.duo || 0) > 0) {
    tags.push(`<span class="raid-tag duo">Duo</span>`);
  }
  if (Number(fireteamSizes.trio || 0) > 0) {
    tags.push(`<span class="raid-tag trio">Trio</span>`);
  }
  for (const tag of Array.isArray(item?.tags) ? item.tags : []) {
    if (["Solo", "Duo", "Trio"].includes(tag)) {
      continue;
    }
    tags.push(`<span class="raid-tag">${escapeHtml(tag)}</span>`);
  }
  if (tags.length === 0) {
    tags.push(`<span class="raid-tag muted">-</span>`);
  }
  return tags;
}

function bungieAssetUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//iu.test(value)) {
    return value;
  }
  return `https://www.bungie.net${value.startsWith("/") ? "" : "/"}${value}`;
}

async function imageDataUrl(url, config, options = {}) {
  if (imageDataUrlCache.has(url)) {
    return imageDataUrlCache.get(url);
  }
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      timeoutMs: Math.min(config.timeoutMs, 12000),
      signal: options.signal,
      fetchImpl: options.fetchImpl,
      headers: { "user-agent": "Mozilla/5.0 OpenClaw-D2Stats" },
    });
    if (!response.ok) {
      imageDataUrlCache.set(url, "");
      return "";
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
    imageDataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    imageDataUrlCache.set(url, "");
    return "";
  }
}

function playerFromBinding(binding) {
  const parsed = parseBoundBungieName(binding.bungieName);
  const displayName = binding.displayName || parsed.displayName || `ID ${String(binding.membershipId || "").slice(-8)}`;
  const displayNameCode = Number(binding.displayNameCode ?? parsed.displayNameCode ?? 0);
  return {
    bungieName: binding.bungieName || (displayNameCode > 0 ? `${displayName}#${displayNameCode}` : displayName),
    displayName,
    displayNameCode,
    membershipType: Number(binding.membershipType),
    membershipId: String(binding.membershipId),
  };
}

function mergePlayerCardIdentity(player, namecard) {
  const profile = namecard?.profile || {};
  const character = pickCurrentCharacter(profile?.characters);
  const summaryMembershipType = namecard?.membershipType ?? profile?.membershipType;
  const summaryMembershipId = namecard?.membershipId ?? profile?.membershipId;
  const parsed = parseBoundBungieName(profile?.bungieName || namecard?.bungieName);
  const displayName = profile?.displayName || namecard?.displayName || parsed.displayName || player?.displayName;
  const displayNameCode = Number(profile?.displayNameCode ?? namecard?.displayNameCode ?? parsed.displayNameCode ?? player?.displayNameCode ?? 0);
  const bungieName =
    profile?.bungieName ||
    namecard?.bungieName ||
    (displayName && displayNameCode > 0 ? `${displayName}#${displayNameCode}` : displayName) ||
    player?.bungieName;
  return {
    ...player,
    bungieName,
    displayName,
    displayNameCode,
    membershipType: Number(player?.membershipType || summaryMembershipType || 0),
    membershipId: String(player?.membershipId || summaryMembershipId || ""),
    iconPath: profile?.iconPath || namecard?.iconPath || player?.iconPath,
    emblemPath: character?.emblemPath || player?.emblemPath,
    emblemBackgroundPath: character?.emblemBackgroundPath || player?.emblemBackgroundPath,
    currentClassName: character ? displayClassName(character) : player?.currentClassName,
    currentLight: Number(character?.light || player?.currentLight || 0),
    lastPlayedAt: character?.dateLastPlayed || profile?.profile?.dateLastPlayed || player?.lastPlayedAt,
  };
}

function pickCurrentCharacter(characters) {
  const rows = Array.isArray(characters) ? characters.filter(Boolean) : [];
  return [...rows].sort((a, b) => {
    const right = new Date(b?.dateLastPlayed || 0).getTime();
    const left = new Date(a?.dateLastPlayed || 0).getTime();
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  })[0];
}

function playerFromSearch(player) {
  return {
    bungieName: player.bungieName || (player.displayNameCode ? `${player.displayName}#${player.displayNameCode}` : player.displayName),
    displayName: player.displayName || player.bungieName || "Guardian",
    displayNameCode: Number(player.displayNameCode || 0),
    membershipType: Number(player.membershipType),
    membershipId: String(player.membershipId),
  };
}

function fallbackPlayer(membershipType, membershipId) {
  const displayName = `ID ${String(membershipId).slice(-8)}`;
  return {
    bungieName: displayName,
    displayName,
    displayNameCode: 0,
    membershipType,
    membershipId,
  };
}

function parseBoundBungieName(value) {
  if (!value) {
    return {};
  }
  const match = /^(.+)#([0-9]{1,4})$/u.exec(String(value).trim());
  if (!match) {
    return { displayName: String(value).trim() };
  }
  return { displayName: match[1], displayNameCode: Number(match[2]) };
}

function formatPlayerName(player) {
  if (player?.displayName && Number(player.displayNameCode) > 0) {
    return `${player.displayName}#${player.displayNameCode}`;
  }
  return player?.bungieName || player?.displayName || "Guardian";
}

function classLabel(classType) {
  if (classType === 0) return "泰坦";
  if (classType === 1) return "猎人";
  if (classType === 2) return "术士";
  return "角色";
}

function displayClassName(character) {
  const raw = String(character?.className || "").trim().toLowerCase();
  if (raw === "titan") return "泰坦";
  if (raw === "hunter") return "猎人";
  if (raw === "warlock") return "术士";
  return character?.className || classLabel(character?.classType);
}

function inferCardFromCommand(value) {
  const command = String(value || "").trim().toLowerCase();
  if (!command) {
    return "";
  }
  if (/帮助|菜单|help|command|指令/u.test(command)) {
    return "help";
  }
  if (/生涯|career/u.test(command)) {
    return "career";
  }
  if (/热力图|活跃|heatmap/u.test(command)) {
    return "heatmap";
  }
  if (/地牢|dungeon/u.test(command)) {
    return "dungeon_overview";
  }
  if (/pvp|试炼|trials|熔炉/u.test(command)) {
    return "pvp";
  }
  if (/raid|突袭|无暇|day\s*one|dayone/u.test(command)) {
    return "raid_overview";
  }
  if (/最近|活动|历史|activity|history/u.test(command)) {
    return "activities";
  }
  if (/单局|pgcr|carnage/u.test(command)) {
    return "activity";
  }
  if (/武器|weapon/u.test(command)) {
    return "weapons";
  }
  if (/名片|namecard/u.test(command)) {
    return "namecard";
  }
  if (/资料|角色|profile|光等/u.test(command)) {
    return "profile";
  }
  if (/智谋|gambit|战绩|summary/u.test(command)) {
    return "summary";
  }
  return "";
}

function activityModeIcon(value) {
  const text = String(value || "").toLowerCase();
  if (/raid|突袭/u.test(text)) return "◆";
  if (/dungeon|地牢/u.test(text)) return "◇";
  if (/trial|试炼/u.test(text)) return "△";
  if (/crucible|熔炉|pvp/u.test(text)) return "×";
  if (/gambit|智谋/u.test(text)) return "◎";
  return "✦";
}

function statValue(values, key) {
  return Number(values?.[key]?.basic?.value || 0);
}

function activityCompleted(activity) {
  return Number(activity?.values?.completed?.basic?.value || 0) > 0;
}

function pill(label, tone = "muted") {
  return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

function normalizeCard(value, fallback) {
  const card = String(value || fallback || "summary").trim();
  if (CARDS.has(card)) {
    return card;
  }
  throw new D2StatsInputError("不支持的卡片类型。");
}

function normalizeMode(value, fallback) {
  const mode = String(value || fallback || "all").trim();
  if (MODES.has(mode)) {
    return mode;
  }
  throw new D2StatsInputError("不支持的查询模式。");
}

function normalizeHeatmapRange(value) {
  const range = String(value || "all").trim();
  if (range === "all" || range === "year" || range === "recent") {
    return range;
  }
  throw new D2StatsInputError("热力图 range 只支持 all、year、recent。");
}

async function fetchWithTimeout(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable");
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, options.timeoutMs);
  options.signal?.addEventListener?.("abort", abort, { once: true });
  try {
    return await fetchImpl(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.("abort", abort);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatBackendError(payload, status) {
  const code = payload?.error?.code || payload?.ErrorStatus || payload?.error || "UNKNOWN";
  const message = payload?.error?.message || payload?.Message || payload?.message || "";
  if (status === 404 && String(message).toLowerCase().includes("qq")) {
    return "该 QQ 未绑定 Bungie ID，请提供 BungieName#1234 / membershipType:membershipId，或先绑定。";
  }
  if (String(message).includes("qq is already bound")) {
    return "该 QQ 已经绑定过 Bungie ID，如需改绑请联系管理员在后台处理。";
  }
  return message ? `命运2查询失败：${message}` : `命运2查询失败：${code}`;
}

function imageResult(params) {
  return {
    content: [
      {
        type: "image",
        data: params.base64,
        mimeType: params.mimeType,
      },
    ],
    details: {
      path: params.path,
      ...params.details,
      media: {
        mediaUrl: params.path,
      },
    },
  };
}

function textResult(text, details = {}) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details,
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function int(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "0";
  }
  if (Math.abs(number) >= 1000000) {
    return `${fixed(number / 1000000, 1)}M`;
  }
  if (Math.abs(number) >= 10000) {
    return `${fixed(number / 1000, 1)}K`;
  }
  return int(number);
}

function fixed(value, digits = 2) {
  const number = Number(value || 0);
  return (Number.isFinite(number) ? number : 0).toFixed(digits).replace(/\.00$/u, "");
}

function percent(value) {
  return `${fixed(value)}%`;
}

function duration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function compactDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = total / 3600;
  if (hours >= 100) {
    return `${fixed(hours, 1)}h`;
  }
  if (hours >= 10) {
    return `${fixed(hours, 1)}h`;
  }
  return duration(total);
}

function dateOnly(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class D2StatsInputError extends Error {}

class D2StatsBackendError extends Error {
  constructor(payload, status, url) {
    super(`Backend request failed: ${status}`);
    this.payload = payload;
    this.status = status;
    this.url = url;
  }
}
