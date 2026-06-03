import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";
import type {
  AccountSummary,
  PgcrSummary,
  PlayerSearchResult,
  ProfileSummary,
  RaidOverview,
  WeaponsSummary
} from "../destiny/destiny-types.js";
import { escapeXml, formatDuration } from "./svg.js";

const WIDTH = 1100;
const HEIGHT = 620;
const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "d2-card-template-v1.png");

let templateDataUrl: Promise<string> | null = null;
let browserPromise: Promise<Browser> | null = null;
let browserIdleTimer: NodeJS.Timeout | null = null;

export class CardService {
  async renderSummaryCard(player: PlayerSearchResult, summary: AccountSummary): Promise<Buffer> {
    const html = await cardHtml(`
      <main class="content summary-card">
        ${headerHtml("DESTINY 2 PUBLIC STATS", formatPlayerName(player), `${summary.modeLabel} 总览 · ${summary.updatedAt.slice(0, 10)}`)}

        <section class="metric-grid">
          ${metricHtml("场次", summary.stats.activitiesEntered)}
          ${metricHtml("胜率", `${summary.stats.winRate}%`)}
          ${metricHtml("KD", summary.stats.kd)}
          ${metricHtml("KDA", summary.stats.kda)}
          ${metricHtml("效率", summary.stats.efficiency)}
        </section>

        <section class="detail-grid">
          <div class="detail-panel">
            ${detailRowHtml("击杀", summary.stats.kills)}
            ${detailRowHtml("死亡", summary.stats.deaths)}
            ${detailRowHtml("助攻", summary.stats.assists)}
          </div>
          <div class="detail-panel">
            ${detailRowHtml("胜场", summary.stats.activitiesWon)}
            ${detailRowHtml("游玩时长", formatDuration(summary.stats.secondsPlayed))}
            ${detailRowHtml("Membership", `${summary.membershipType}:${summary.membershipId}`, "compact")}
          </div>
        </section>
      </main>
    `);

    return renderHtmlPng(html);
  }

  async renderActivityCard(pgcr: PgcrSummary): Promise<Buffer> {
    const rows = pgcr.players
      .slice(0, 6)
      .map(
        (player, index) => `
          <div class="table-row activity-row">
            <div class="rank">${index + 1}</div>
            <div class="name">${escapeHtml(player.displayName)}</div>
            <div class="num">${escapeHtml(player.kills)}</div>
            <div class="num">${escapeHtml(player.deaths)}</div>
            <div class="num">${escapeHtml(player.assists)}</div>
            <div class="num">${escapeHtml(player.kda)}</div>
          </div>
        `
      )
      .join("");

    const html = await cardHtml(`
      <main class="content">
        ${headerHtml("POST GAME CARNAGE REPORT", pgcr.activityName, `${pgcr.modeName ?? "未知模式"} · ${pgcr.period ?? pgcr.activityId}`, "activity")}

        <section class="table-panel">
          <div class="table-head activity-row">
            <div></div>
            <div>玩家</div>
            <div>K</div>
            <div>D</div>
            <div>A</div>
            <div>KDA</div>
          </div>
          ${rows || `<div class="empty-state">暂无单局玩家数据</div>`}
        </section>
      </main>
    `);

    return renderHtmlPng(html);
  }

  async renderProfileCard(player: PlayerSearchResult, profile: ProfileSummary): Promise<Buffer> {
    const rows = profile.characters
      .slice(0, 3)
      .map(
        (character) => `
          <div class="table-row profile-row">
            <div class="name">${escapeHtml(character.className)}</div>
            <div class="num">${escapeHtml(character.light)}</div>
            <div class="num">${escapeHtml(formatDuration(character.minutesPlayedTotal * 60))}</div>
            <div class="num small">${escapeHtml(formatDate(character.dateLastPlayed))}</div>
          </div>
        `
      )
      .join("");

    const html = await cardHtml(`
      <main class="content">
        ${headerHtml(
          "DESTINY 2 PROFILE",
          formatPlayerName(player),
          `最后游玩 ${formatDate(profile.profile.dateLastPlayed)} · 总时长 ${formatDuration(profile.profile.minutesPlayedTotal * 60)}`
        )}

        <section class="metric-grid profile-metrics">
          ${metricHtml("角色数", profile.characters.length)}
          ${metricHtml("最高光等", highestLight(profile))}
          ${metricHtml("账号时长", formatDuration(profile.profile.minutesPlayedTotal * 60))}
          ${metricHtml("Membership", `${profile.membershipType}:${profile.membershipId.slice(-8)}`)}
        </section>

        <section class="table-panel compact-table">
          <div class="table-head profile-row">
            <div>职业</div>
            <div>光等</div>
            <div>时长</div>
            <div>最后游玩</div>
          </div>
          ${rows || `<div class="empty-state">暂无角色数据</div>`}
        </section>
      </main>
    `);

    return renderHtmlPng(html);
  }

  async renderWeaponsCard(player: PlayerSearchResult, weapons: WeaponsSummary): Promise<Buffer> {
    const rows = weapons.weapons
      .slice(0, 8)
      .map(
        (weapon, index) => `
          <div class="table-row weapon-row">
            <div class="rank">${index + 1}</div>
            <div class="name">${escapeHtml(weapon.name)}</div>
            <div class="num">${escapeHtml(weapon.kills)}</div>
            <div class="num">${escapeHtml(weapon.precisionKills)}</div>
            <div class="num">${escapeHtml(formatDuration(weapon.secondsUsed))}</div>
          </div>
        `
      )
      .join("");

    const html = await cardHtml(`
      <main class="content">
        ${headerHtml("DESTINY 2 WEAPONS", formatPlayerName(player), `武器使用统计 · ${weapons.updatedAt.slice(0, 10)}`)}

        <section class="table-panel weapons-table">
          <div class="table-head weapon-row">
            <div></div>
            <div>武器</div>
            <div>击杀</div>
            <div>精准</div>
            <div>使用</div>
          </div>
          ${rows || `<div class="empty-state">暂无武器数据</div>`}
        </section>
      </main>
    `);

    return renderHtmlPng(html);
  }

  async renderRaidOverviewCard(player: PlayerSearchResult, overview: RaidOverview): Promise<Buffer> {
    const rows = overview.raids
      .slice(0, 10)
      .map(
        (raid) => `
          <div class="table-row raid-row">
            <div class="name">${escapeHtml(raid.name)}</div>
            <div class="num">${escapeHtml(raid.clears)}</div>
            <div class="num">${escapeHtml(raid.fastestCompletionDisplay ?? "-")}</div>
            <div class="num">${escapeHtml(formatDuration(raid.secondsPlayed))}</div>
            <div class="badge ${raid.flawless.status === "confirmed" ? "ok" : ""}">${escapeHtml(statusLabel(raid.flawless.status))}</div>
            <div class="badge ${raid.dayOne.status === "confirmed" ? "ok" : ""}">${escapeHtml(statusLabel(raid.dayOne.status))}</div>
          </div>
        `
      )
      .join("");

    const html = await cardHtml(`
      <main class="content">
        ${headerHtml("DESTINY 2 RAID OVERVIEW", formatPlayerName(player), `突袭总览 · ${overview.updatedAt.slice(0, 10)}`)}

        <section class="metric-grid profile-metrics">
          ${metricHtml("突袭数", overview.totals.raids)}
          ${metricHtml("通关", overview.totals.clears)}
          ${metricHtml("击杀", overview.totals.kills)}
          ${metricHtml("游玩时长", formatDuration(overview.totals.secondsPlayed))}
        </section>

        <section class="table-panel raid-table">
          <div class="table-head raid-row">
            <div>突袭</div>
            <div>通关</div>
            <div>最快</div>
            <div>时长</div>
            <div>无暇</div>
            <div>Day One</div>
          </div>
          ${rows || `<div class="empty-state">暂无突袭数据</div>`}
          <div class="scan-note">PGCR ${overview.scan.pgcrScanned}/${overview.scan.pgcrLimit} · ${escapeHtml(overview.scan.note)}</div>
        </section>
      </main>
    `);

    return renderHtmlPng(html);
  }
}

async function cardHtml(content: string): Promise<string> {
  const background = await loadTemplateDataUrl();
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body {
            width: ${WIDTH}px;
            height: ${HEIGHT}px;
            margin: 0;
            overflow: hidden;
            background: transparent;
          }
          body {
            font-family: "Noto Sans CJK SC", "Noto Sans CJK", "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;
            color: #f6f8fb;
            font-variant-numeric: tabular-nums;
          }
          .card {
            position: relative;
            width: ${WIDTH}px;
            height: ${HEIGHT}px;
            overflow: hidden;
            background:
              linear-gradient(180deg, rgba(3, 7, 12, 0.22), rgba(3, 7, 12, 0.42)),
              url("${background}") center / cover no-repeat;
          }
          .content {
            position: absolute;
            inset: 0;
            padding: 52px 56px 38px;
          }
          .eyebrow {
            color: #8eb8f5;
            font-size: 24px;
            line-height: 1;
            font-weight: 760;
          }
          .title {
            width: 760px;
            margin-top: 14px;
            color: #f7fbff;
            font-size: 56px;
            line-height: 0.98;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .title.activity {
            width: 900px;
            font-size: 46px;
          }
          .subtitle {
            width: 720px;
            margin-top: 16px;
            color: #b9c4d1;
            font-size: 27px;
            line-height: 1;
            font-weight: 520;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .header-rule {
            position: absolute;
            left: 40px;
            right: 40px;
            top: 220px;
            height: 1px;
            background: rgba(215, 230, 245, 0.22);
          }
          .subtitle-accent {
            width: 198px;
            height: 2px;
            margin-top: 12px;
            background: rgba(212, 175, 111, 0.62);
          }
          .metric-grid {
            position: absolute;
            left: 56px;
            right: 56px;
            top: 252px;
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 16px;
          }
          .metric-grid.profile-metrics {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .metric {
            position: relative;
            min-width: 0;
            height: 112px;
            padding: 18px 18px 14px;
            border: 1px solid rgba(174, 193, 211, 0.18);
            background: rgba(7, 15, 24, 0.52);
          }
          .metric::before {
            content: "";
            position: absolute;
            left: 16px;
            top: -1px;
            width: 52px;
            height: 1px;
            background: rgba(215, 230, 245, 0.46);
          }
          .metric::after {
            content: "";
            position: absolute;
            left: 50%;
            bottom: -8px;
            width: 0;
            height: 0;
            transform: translateX(-50%);
            border-left: 9px solid transparent;
            border-right: 9px solid transparent;
            border-top: 8px solid rgba(212, 175, 111, 0.82);
          }
          .metric-label {
            color: #9faebe;
            font-size: 24px;
            line-height: 1;
            font-weight: 680;
          }
          .metric-value {
            width: 100%;
            margin-top: 10px;
            color: #ffffff;
            font-size: var(--value-size);
            line-height: 1;
            font-weight: 820;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: clip;
          }
          .detail-grid {
            position: absolute;
            left: 56px;
            right: 56px;
            top: 404px;
            display: grid;
            grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr);
            gap: 40px;
          }
          .detail-panel {
            min-width: 0;
            padding: 14px 18px 16px;
            border-left: 1px solid rgba(215, 230, 245, 0.3);
            background: linear-gradient(90deg, rgba(7, 15, 24, 0.42), rgba(7, 15, 24, 0.08));
          }
          .detail-row {
            display: grid;
            grid-template-columns: 168px minmax(0, 1fr);
            align-items: baseline;
            gap: 12px;
            min-height: 42px;
          }
          .detail-label,
          .table-head {
            color: #9faebe;
            font-size: 24px;
            line-height: 1;
            font-weight: 680;
          }
          .detail-label {
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .detail-value {
            min-width: 0;
            color: #f7fbff;
            font-size: var(--detail-size);
            line-height: 1;
            font-weight: 760;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .detail-value.compact {
            font-size: 22px;
          }
          .table-panel {
            position: absolute;
            left: 56px;
            right: 56px;
            top: 234px;
            bottom: 42px;
            padding: 18px 20px;
            border: 1px solid rgba(174, 193, 211, 0.18);
            background: rgba(7, 15, 24, 0.52);
          }
          .table-panel.compact-table {
            top: 388px;
          }
          .table-panel.weapons-table {
            top: 234px;
          }
          .table-panel.raid-table {
            top: 388px;
            padding-bottom: 28px;
          }
          .table-head,
          .table-row {
            display: grid;
            align-items: center;
            min-width: 0;
          }
          .table-head {
            height: 34px;
            border-bottom: 1px solid rgba(215, 230, 245, 0.18);
          }
          .table-row {
            min-height: 46px;
            border-bottom: 1px solid rgba(215, 230, 245, 0.08);
          }
          .activity-row {
            grid-template-columns: 52px minmax(0, 1fr) 120px 120px 120px 120px;
          }
          .profile-row {
            grid-template-columns: minmax(0, 1.3fr) 160px 220px 200px;
          }
          .weapon-row {
            grid-template-columns: 52px minmax(0, 1fr) 140px 140px 160px;
          }
          .raid-row {
            grid-template-columns: minmax(0, 1.45fr) 84px 132px 132px 104px 120px;
            column-gap: 8px;
          }
          .rank {
            color: #8eb8f5;
            font-size: 25px;
            font-weight: 800;
          }
          .name {
            min-width: 0;
            color: #f7fbff;
            font-size: 28px;
            font-weight: 720;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .weapon-row .name {
            font-size: 23px;
          }
          .num {
            color: #f7fbff;
            font-size: 27px;
            font-weight: 760;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .num.small {
            font-size: 22px;
          }
          .badge {
            color: #b9c4d1;
            font-size: 18px;
            font-weight: 720;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .badge.ok {
            color: #d4af6f;
          }
          .scan-note {
            position: absolute;
            left: 20px;
            right: 20px;
            bottom: 10px;
            color: rgba(185, 196, 209, 0.72);
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .empty-state {
            padding-top: 54px;
            color: #b9c4d1;
            font-size: 27px;
          }
        </style>
      </head>
      <body>
        <section class="card">
          ${content}
        </section>
      </body>
    </html>`;
}

function headerHtml(eyebrow: string, title: string, subtitle: string, titleVariant = ""): string {
  return `
    <div class="eyebrow">${escapeHtml(eyebrow)}</div>
    <div class="title ${titleVariant}">${escapeHtml(title)}</div>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
    <div class="subtitle-accent"></div>
    <div class="header-rule"></div>
  `;
}

function metricHtml(label: string, value: string | number): string {
  const display = String(value);
  return `
    <article class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value" style="--value-size: ${metricFontSize(display)}px">${escapeHtml(display)}</div>
    </article>
  `;
}

function detailRowHtml(label: string, value: string | number, variant = ""): string {
  const display = String(value);
  return `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value ${variant}" style="--detail-size: ${detailFontSize(display)}px">${escapeHtml(display)}</div>
    </div>
  `;
}

function statusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "确认";
    case "not_found_in_scanned_pgcr":
      return "未发现";
    default:
      return "未知";
  }
}

async function renderHtmlPng(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });

  try {
    await page.setContent(html, { waitUntil: "load" });
    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      animations: "disabled"
    });
    return Buffer.from(png);
  } finally {
    await page.close().catch(() => undefined);
    scheduleBrowserClose();
  }
}

async function getBrowser(): Promise<Browser> {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }

  browserPromise ??= chromium.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });

  return browserPromise;
}

function scheduleBrowserClose(): void {
  const delay = process.env.VITEST ? 500 : 30_000;
  browserIdleTimer = setTimeout(async () => {
    const current = browserPromise;
    browserPromise = null;
    browserIdleTimer = null;
    if (current) {
      await current.then((browser) => browser.close()).catch(() => undefined);
    }
  }, delay);
  browserIdleTimer.unref?.();
}

async function loadTemplateDataUrl(): Promise<string> {
  templateDataUrl ??= readFile(TEMPLATE_PATH).then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`);
  return templateDataUrl;
}

function findBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.CARD_BROWSER_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate));
}

function metricFontSize(value: string): number {
  const length = [...value].length;
  if (length >= 9) {
    return 34;
  }
  if (length >= 7) {
    return 38;
  }
  if (length >= 6) {
    return 42;
  }
  return 50;
}

function detailFontSize(value: string): number {
  const length = [...value].length;
  if (length >= 24) {
    return 22;
  }
  if (length >= 14) {
    return 25;
  }
  return 30;
}

function escapeHtml(value: unknown): string {
  return escapeXml(value);
}

function formatPlayerName(player: PlayerSearchResult): string {
  if (player.displayNameCode > 0) {
    return `${player.displayName}#${String(player.displayNameCode).padStart(4, "0")}`;
  }
  return player.displayName;
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "未知";
  }
  return value.slice(0, 10);
}

function highestLight(profile: ProfileSummary): number {
  return profile.characters.reduce((max, character) => Math.max(max, character.light), 0);
}
