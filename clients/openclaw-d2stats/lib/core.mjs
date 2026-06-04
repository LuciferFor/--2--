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

export function resolveConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    baseUrl: String(raw.baseUrl || "http://192.168.31.11:3011").replace(/\/+$/u, ""),
    timeoutMs: clampInteger(raw.timeoutMs, 10000, 1000, 60000),
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
    query.set("count", String(clampInteger(params.count, 10, 1, 50)));
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
    query.set("historyPages", String(clampInteger(params.historyPages, 1, 1, 10)));
    query.set("pgcrLimit", String(clampInteger(params.pgcrLimit, 20, 0, 200)));
    return `${config.baseUrl}/api/d2/raids/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "dungeons") {
    query.set("historyPages", String(clampInteger(params.historyPages, 1, 1, 10)));
    return `${config.baseUrl}/api/d2/dungeons/${target.membershipType}/${target.membershipId}?${query.toString()}`;
  }

  if (kind === "heatmap") {
    query.set("mode", normalizeMode(params.mode, config.defaultMode));
    query.set("pages", String(clampInteger(params.pages, 2, 1, 10)));
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
    return textResult("绑定需要 BungieName#1234 或 membershipType:membershipId。", { status: "invalid_input" });
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

  const resolved = await resolveTargetMembership(params.target, config, options);

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
      height: 700,
      sourceUrl,
      html: renderCareerHtml(resolved.player, career),
    };
  }

  if (card === "pvp") {
    const sourceUrl = buildPublicDataUrl("pvp", resolved, params, config);
    const pvp = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 760,
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
      html: renderActivityHtml(pgcr),
    };
  }

  if (card === "raid_overview") {
    const sourceUrl = buildPublicDataUrl("raids", resolved, params, config);
    const overview = await fetchEnvelope(sourceUrl, config, options);
    return {
      width: CARD_WIDTH,
      height: 720,
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
      width: CARD_WIDTH,
      height: 720,
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
    const binding = await fetchEnvelope(url, config, options);
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
  const all = rows.find((item) => item.mode === "all")?.stats || rows[0]?.stats || {};
  return cardPage({
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 CAREER",
    subtitle: `生涯数据 · ${dateOnly(career?.updatedAt)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("总场次", int(all.activitiesEntered))}
        ${metric("胜率", percent(all.winRate))}
        ${metric("KD", fixed(all.kd))}
        ${metric("游玩时长", duration(all.secondsPlayed))}
      </section>
      <section class="table career-table">
        <div class="table-head career-grid">
          <div>模式</div><div>场次</div><div>胜率</div><div>KD</div><div>KDA</div><div>时长</div>
        </div>
        ${rows
          .map((item) => {
            const stats = item?.stats || {};
            return `
              <div class="table-row career-grid">
                <div class="name">${escapeHtml(item?.modeLabel || item?.mode || "-")}</div>
                <div>${int(stats.activitiesEntered)}</div>
                <div>${percent(stats.winRate)}</div>
                <div>${fixed(stats.kd)}</div>
                <div>${fixed(stats.kda)}</div>
                <div>${duration(stats.secondsPlayed)}</div>
              </div>
            `;
          })
          .join("")}
      </section>
      ${membershipBlock(career?.membershipType, career?.membershipId)}
    `,
  });
}

function renderPvpHtml(player, pvp) {
  const stats = pvp?.summary?.stats || {};
  const trials = pvp?.trials?.stats || {};
  const recent = Array.isArray(pvp?.recent) ? pvp.recent.slice(0, 6) : [];
  return cardPage({
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 PVP",
    subtitle: `熔炉 / 试炼 · ${dateOnly(pvp?.updatedAt)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("PVP 场次", int(stats.activitiesEntered))}
        ${metric("PVP KD", fixed(stats.kd))}
        ${metric("试炼胜率", percent(trials.winRate))}
        ${metric("试炼 KD", fixed(trials.kd))}
      </section>
      <section class="activity-list compact">
        ${recent
          .map((item) => {
            const values = item?.values || {};
            const completed = Number(values?.completed?.basic?.value || 0) > 0;
            return `
              <div class="activity-card-row">
                <div class="activity-mark">×</div>
                <div class="activity-main">
                  <strong>${escapeHtml(item?.activityName || "Unknown Activity")}</strong>
                  <span>${escapeHtml(item?.modeName || "PVP")} · ${dateOnly(item?.period)}</span>
                  <div class="tag-line">${completed ? pill("胜/完成", "green") : pill("记录", "muted")} ${pill(`PGCR ${item?.activityId || "-"}`, "muted")}</div>
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
      <footer class="card-footer">武器榜来自 Bungie UniqueWeapons 公开生涯统计；PVP 分模式武器需要更深的 PGCR 扫描或 OAuth 数据。</footer>
    `,
  });
}

function renderNamecardHtml(player, namecard) {
  const profile = namecard?.profile || {};
  const summary = namecard?.summary?.stats || {};
  const characters = Array.isArray(profile?.characters) ? profile.characters.slice(0, 3) : [];
  return cardPage({
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

function renderActivityHtml(pgcr) {
  const players = Array.isArray(pgcr?.players) ? pgcr.players.slice(0, 8) : [];
  return cardPage({
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
  const rows = Array.isArray(overview?.raids) ? overview.raids.slice(0, 10) : [];
  const totals = overview?.totals || {};
  const rowsWithImages = await Promise.all(
    rows.map(async (item) => ({
      item,
      imageDataUrl: item.pgcrImage ? await imageDataUrl(bungieAssetUrl(item.pgcrImage), config, options) : "",
    })),
  );
  return cardPage({
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 RAID OVERVIEW",
    subtitle: `突袭总览 · ${dateOnly(overview?.updatedAt)}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("突袭数", int(totals.raids))}
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
                  <span>${statusBadge(item.flawless?.status, "无暇")} ${statusBadge(item.dayOne?.status, "Day One")}</span>
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
      <footer class="card-footer">
        扫描最近 ${int(overview?.scan?.pgcrScanned)} 场 PGCR；无暇 / Day One 未发现表示当前扫描范围内未确认。
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
  const days = Array.isArray(heatmap?.days) ? heatmap.days.slice(-28) : [];
  const hours = Array.isArray(heatmap?.hours) ? heatmap.hours : [];
  const maxDay = Math.max(1, ...days.map((item) => Number(item.activities || 0)));
  const maxHour = Math.max(1, ...hours.map((item) => Number(item.activities || 0)));
  return cardPage({
    title: formatPlayerName(player),
    eyebrow: "DESTINY 2 ACTIVITY HEATMAP",
    subtitle: `${heatmap?.modeLabel || "全部"}活跃 · ${escapeHtml(heatmap?.timezone || "Asia/Shanghai")}`,
    body: `
      <section class="metrics metrics-4">
        ${metric("扫描活动", int(heatmap?.activitiesScanned))}
        ${metric("完成", int(days.reduce((sum, item) => sum + Number(item.completed || 0), 0)))}
        ${metric("击杀", int(days.reduce((sum, item) => sum + Number(item.kills || 0), 0)))}
        ${metric("时长", duration(days.reduce((sum, item) => sum + Number(item.secondsPlayed || 0), 0)))}
      </section>
      <section class="heatmap-panel">
        <h2>最近日期</h2>
        <div class="heatmap-days">
          ${days
            .map((item) => {
              const width = Math.max(4, Math.round((Number(item.activities || 0) / maxDay) * 100));
              return `
                <div class="heatmap-row">
                  <span>${escapeHtml(item.key)}</span>
                  <b><i style="width:${width}%"></i></b>
                  <strong>${int(item.activities)}</strong>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
      <section class="heatmap-panel hours">
        <h2>小时分布</h2>
        <div class="hour-bars">
          ${hours
            .map((item) => {
              const height = Math.max(6, Math.round((Number(item.activities || 0) / maxHour) * 86));
              return `<div class="hour-bar"><b style="height:${height}px"></b><span>${escapeHtml(item.key)}</span></div>`;
            })
            .join("")}
        </div>
      </section>
    `,
  });
}

function cardPage({ eyebrow, title, subtitle, body }) {
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
      width: ${CARD_WIDTH}px;
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
      padding: 18px 22px 20px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      background: rgba(20, 20, 20, 0.78);
      border-radius: 8px;
      margin-bottom: 18px;
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
    .heatmap-panel {
      margin-top: 14px;
      padding: 16px 18px;
      background: rgba(17, 17, 17, 0.86);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
    }
    .heatmap-panel h2 {
      margin: 0 0 12px;
      color: #a8a8a8;
      font-size: 22px;
      line-height: 1.2;
    }
    .heatmap-days {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 18px;
    }
    .heatmap-row {
      display: grid;
      grid-template-columns: 126px minmax(0, 1fr) 48px;
      gap: 10px;
      align-items: center;
      min-width: 0;
      font-size: 17px;
      font-weight: 800;
    }
    .heatmap-row span {
      color: #c8d2de;
      white-space: nowrap;
    }
    .heatmap-row b {
      display: block;
      height: 10px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
    }
    .heatmap-row i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #21d07a, #7db3ff);
      border-radius: inherit;
    }
    .heatmap-row strong {
      text-align: right;
      color: #ffffff;
    }
    .hour-bars {
      display: grid;
      grid-template-columns: repeat(24, minmax(0, 1fr));
      gap: 7px;
      align-items: end;
      min-height: 124px;
    }
    .hour-bar {
      display: grid;
      justify-items: center;
      gap: 8px;
      color: #a8a8a8;
      font-size: 14px;
      font-weight: 800;
    }
    .hour-bar b {
      display: block;
      width: 100%;
      min-height: 6px;
      border-radius: 4px 4px 0 0;
      background: linear-gradient(180deg, #7db3ff, #21d07a);
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
      <header class="header">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
      </header>
      ${body}
    </div>
  </main>
</body>
</html>`;
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
