import sharp from "sharp";
import type { AccountSummary, PgcrSummary, PlayerSearchResult } from "../destiny/destiny-types.js";
import { escapeXml, formatDuration, statBlock } from "./svg.js";

const WIDTH = 1100;
const HEIGHT = 620;

export class CardService {
  async renderSummaryCard(player: PlayerSearchResult, summary: AccountSummary): Promise<Buffer> {
    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        ${baseStyle()}
        ${background()}
        <text class="eyebrow" x="56" y="76">DESTINY 2 PUBLIC STATS</text>
        <text class="title" x="56" y="140">${escapeXml(player.displayName)}#${String(player.displayNameCode).padStart(4, "0")}</text>
        <text class="subtitle" x="58" y="188">${escapeXml(summary.modeLabel)} 总览 · ${escapeXml(summary.updatedAt.slice(0, 10))}</text>

        ${statBlock("场次", summary.stats.activitiesEntered, 64, 280)}
        ${statBlock("胜率", `${summary.stats.winRate}%`, 298, 280)}
        ${statBlock("KD", summary.stats.kd, 520, 280)}
        ${statBlock("KDA", summary.stats.kda, 720, 280)}
        ${statBlock("效率", summary.stats.efficiency, 920, 280)}

        <g transform="translate(64, 430)">
          <text class="line-label" x="0" y="0">击杀</text>
          <text class="line-value" x="140" y="0">${summary.stats.kills}</text>
          <text class="line-label" x="0" y="42">死亡</text>
          <text class="line-value" x="140" y="42">${summary.stats.deaths}</text>
          <text class="line-label" x="0" y="84">助攻</text>
          <text class="line-value" x="140" y="84">${summary.stats.assists}</text>
        </g>

        <g transform="translate(570, 430)">
          <text class="line-label" x="0" y="0">胜场</text>
          <text class="line-value" x="160" y="0">${summary.stats.activitiesWon}</text>
          <text class="line-label" x="0" y="42">游玩时长</text>
          <text class="line-value" x="160" y="42">${escapeXml(formatDuration(summary.stats.secondsPlayed))}</text>
          <text class="line-label" x="0" y="84">Membership</text>
          <text class="line-value small" x="160" y="84">${summary.membershipType}:${escapeXml(summary.membershipId)}</text>
        </g>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  async renderActivityCard(pgcr: PgcrSummary): Promise<Buffer> {
    const topPlayers = pgcr.players.slice(0, 6);
    const rows = topPlayers
      .map(
        (player, index) => `
          <g transform="translate(64, ${254 + index * 55})">
            <text class="rank" x="0" y="0">${index + 1}</text>
            <text class="player-name" x="58" y="0">${escapeXml(player.displayName)}</text>
            <text class="row-stat" x="565" y="0">${player.kills}</text>
            <text class="row-stat" x="690" y="0">${player.deaths}</text>
            <text class="row-stat" x="815" y="0">${player.assists}</text>
            <text class="row-stat" x="940" y="0">${player.kda}</text>
          </g>
        `
      )
      .join("");

    const svg = `
      <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        ${baseStyle()}
        ${background()}
        <text class="eyebrow" x="56" y="76">POST GAME CARNAGE REPORT</text>
        <text class="title activity" x="56" y="138">${escapeXml(pgcr.activityName)}</text>
        <text class="subtitle" x="58" y="186">${escapeXml(pgcr.modeName ?? "未知模式")} · ${escapeXml(pgcr.period ?? pgcr.activityId)}</text>

        <g transform="translate(64, 218)">
          <text class="table-head" x="58" y="0">玩家</text>
          <text class="table-head" x="565" y="0">K</text>
          <text class="table-head" x="690" y="0">D</text>
          <text class="table-head" x="815" y="0">A</text>
          <text class="table-head" x="940" y="0">KDA</text>
        </g>
        ${rows}
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }
}

function baseStyle(): string {
  return `
    <style>
      svg {
        font-family: "Noto Sans CJK SC", "Noto Sans CJK", "Noto Sans", Arial, sans-serif;
      }
      .eyebrow { fill: #8bb8ff; font-size: 25px; font-weight: 700; letter-spacing: 0; }
      .title { fill: #f7fbff; font-size: 58px; font-weight: 800; letter-spacing: 0; }
      .title.activity { font-size: 48px; }
      .subtitle { fill: #bac8d9; font-size: 27px; font-weight: 500; letter-spacing: 0; }
      .stat-label, .line-label, .table-head { fill: #99a8ba; font-size: 24px; font-weight: 600; letter-spacing: 0; }
      .stat-value { fill: #ffffff; font-size: 48px; font-weight: 800; letter-spacing: 0; }
      .line-value { fill: #f7fbff; font-size: 30px; font-weight: 700; letter-spacing: 0; }
      .line-value.small { font-size: 22px; }
      .rank { fill: #8bb8ff; font-size: 26px; font-weight: 800; letter-spacing: 0; }
      .player-name { fill: #f7fbff; font-size: 30px; font-weight: 700; letter-spacing: 0; }
      .row-stat { fill: #f7fbff; font-size: 28px; font-weight: 700; letter-spacing: 0; text-anchor: middle; }
    </style>
  `;
}

function background(): string {
  return `
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#111923" />
        <stop offset="58%" stop-color="#172b38" />
        <stop offset="100%" stop-color="#263033" />
      </linearGradient>
      <linearGradient id="accent" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="#8bb8ff" />
        <stop offset="100%" stop-color="#9ee6c2" />
      </linearGradient>
    </defs>
    <rect width="1100" height="620" fill="url(#bg)" />
    <rect x="0" y="0" width="1100" height="10" fill="url(#accent)" />
    <rect x="40" y="220" width="1020" height="1" fill="#365268" />
    <rect x="40" y="590" width="1020" height="1" fill="#365268" />
  `;
}
