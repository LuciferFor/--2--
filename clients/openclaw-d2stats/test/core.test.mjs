import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyLoadoutOptimizer,
  bindQq,
  buildPublicDataUrl,
  itemAction,
  parseTarget,
  queryCard,
  queryInventory,
  queryLoadoutOptimizer,
  resolveConfig,
} from "../lib/core.mjs";

describe("d2stats core", () => {
  it("parses supported target formats", () => {
    const config = resolveConfig({ defaultMembershipType: 3 });
    assert.deepEqual(parseTarget("607972716", config), { kind: "qq", qq: "607972716" });
    assert.deepEqual(parseTarget("DLIVX#411", config), { kind: "bungieName", bungieName: "DLIVX#411" });
    assert.deepEqual(parseTarget("3:4611686018428939884", config), {
      kind: "membership",
      membershipType: 3,
      membershipId: "4611686018428939884",
    });
    assert.deepEqual(parseTarget("4611686018428939884", config), {
      kind: "membership",
      membershipType: 3,
      membershipId: "4611686018428939884",
      assumedMembershipType: true,
    });
  });

  it("builds public JSON data URLs", () => {
    const target = { membershipType: 3, membershipId: "4611686018428939884" };
    const summary = buildPublicDataUrl("summary", target, { mode: "raid" }, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(summary, "http://d2.local/api/d2/summary/3/4611686018428939884?mode=raid");

    const raidOverview = buildPublicDataUrl(
      "raids",
      target,
      { historyPages: 2, pgcrLimit: 50 },
      resolveConfig({ baseUrl: "http://d2.local" }),
    );
    assert.equal(raidOverview, "http://d2.local/api/d2/raids/3/4611686018428939884?historyPages=2&pgcrLimit=50");

    const career = buildPublicDataUrl("career", target, {}, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(career, "http://d2.local/api/d2/career/3/4611686018428939884");

    const pvp = buildPublicDataUrl("pvp", target, { count: 12 }, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(pvp, "http://d2.local/api/d2/pvp/3/4611686018428939884?count=12");

    const crafting = buildPublicDataUrl("craftables", target, {}, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(crafting, "http://d2.local/api/d2/craftables/3/4611686018428939884");

    const catalysts = buildPublicDataUrl("catalysts", { qq: "607972716" }, {}, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(catalysts, "http://d2.local/api/d2/catalysts/qq/607972716");

    const dungeons = buildPublicDataUrl("dungeons", target, { historyPages: 3 }, resolveConfig({ baseUrl: "http://d2.local" }));
    assert.equal(dungeons, "http://d2.local/api/d2/dungeons/3/4611686018428939884?historyPages=3&pgcrLimit=50");

    const grandmasters = buildPublicDataUrl(
      "grandmasters",
      target,
      { historyPages: 10, pgcrLimit: 50, season: "current" },
      resolveConfig({ baseUrl: "http://d2.local" }),
    );
    assert.equal(grandmasters, "http://d2.local/api/d2/grandmasters/3/4611686018428939884?historyPages=10&pgcrLimit=50&season=current");

    const heatmap = buildPublicDataUrl(
      "heatmap",
      target,
      { mode: "raid", pages: 4, timezone: "Asia/Shanghai" },
      resolveConfig({ baseUrl: "http://d2.local" }),
    );
    assert.equal(heatmap, "http://d2.local/api/d2/heatmap/3/4611686018428939884?mode=raid&range=all&timezone=Asia%2FShanghai");
  });

  it("returns an image result from OpenClaw-rendered raid HTML", async () => {
    const seenUrls = [];
    const result = await queryCard(
      { target: "607972716", card: "raid_overview", historyPages: 2, pgcrLimit: 50 },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: {
                  profile: { dateLastPlayed: "2026-06-03T00:00:00.000Z" },
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              totals: { raids: 1, clears: 2, kills: 300, deaths: 20, secondsPlayed: 7200 },
              raids: [
                {
                  name: "玻璃拱顶",
                  clears: 2,
                  kills: 300,
                  deaths: 20,
                  secondsPlayed: 7200,
                  fastestCompletionDisplay: "30:00.000",
                  flawless: { status: "confirmed" },
                  dayOne: { status: "not_found_in_scanned_pgcr" },
                },
              ],
              scan: { pgcrScanned: 4 },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 RAID OVERVIEW/);
          assert.match(html, /玻璃拱顶/);
          assert.match(html, /ID 3:4611686018428939884/);
          assert.match(html, /current-card\.jpg/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/raids/3/4611686018428939884?historyPages=2&pgcrLimit=50",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.content[0].mimeType, "image/png");
    assert.equal(result.details.bytes, 9);
    assert.equal(result.details.renderedBy, "openclaw-html");
  });

  it("renders summary from JSON instead of backend card PNGs", async () => {
    const result = await queryCard(
      { target: "3:4611686018428939884", card: "summary", mode: "raid" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          assert.equal(String(url), "http://d2.local/api/d2/summary/3/4611686018428939884?mode=raid");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              mode: "raid",
              modeLabel: "突袭",
              stats: {
                activitiesEntered: 10,
                activitiesWon: 8,
                kills: 100,
                deaths: 20,
                assists: 30,
                secondsPlayed: 3600,
                kd: 5,
                kda: 5.75,
                efficiency: 6.5,
                winRate: 80,
              },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 PUBLIC STATS/);
          assert.match(html, /突袭/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.sourceUrl, "http://d2.local/api/d2/summary/3/4611686018428939884?mode=raid");
  });

  it("renders detailed PvP cards from recent PGCR aggregates", async () => {
    const result = await queryCard(
      { target: "3:4611686018428939884", card: "pvp", count: 50 },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          assert.equal(String(url), "http://d2.local/api/d2/pvp/3/4611686018428939884?count=50");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              summary: {
                stats: { kills: 12721, activitiesWon: 419, activitiesEntered: 2932, kd: 1.4, winRate: 43.8 },
              },
              trials: { stats: { kd: 0, winRate: 0 } },
              aggregates: {
                matchesScanned: 50,
                wins: 30,
                losses: 20,
                kills: 500,
                deaths: 250,
                assists: 100,
                kd: 2,
                kda: 2.2,
                bestKills: 35,
                bestKd: 8.75,
                flawlessMatches: 3,
              },
              modeBreakdown: [{ modeName: "Control", matches: 20, wins: 12, kd: 2.1, winRate: 60 }],
              kdComparison: [{ activityId: "1", activityName: "Javelin-4", playerKd: 2, teamKd: 1.2, opponentKd: 1.1, result: "win" }],
              recentWeapons: [{ referenceId: "1", name: "Rose", kills: 68, precisionKills: 42, secondsUsed: 0, matchesUsed: 10 }],
              matches: [
                {
                  activityId: "1",
                  activityName: "Javelin-4",
                  modeName: "Control",
                  result: "win",
                  score: "150 - 120",
                  kills: 20,
                  deaths: 4,
                  assists: 8,
                  kd: 5,
                  kda: 6,
                  teamKd: 1.5,
                  opponentKd: 1.1,
                  weapons: [{ referenceId: "1", name: "Rose", kills: 10, precisionKills: 7, precisionRate: 70 }],
                },
              ],
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 PVP/);
          assert.match(html, /玩家近期 20 场 KD 对比柱形图/);
          assert.match(html, /玩家近期 50 场武器击杀记录/);
          assert.match(html, /Javelin-4/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "pvp");
  });

  it("renders a help menu without target", async () => {
    const result = await queryCard(
      { card: "help" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () => {
          throw new Error("help card should not fetch backend JSON");
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 COMMANDS/);
          assert.match(html, /命运2查询菜单/);
          assert.match(html, /\/raid/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "help");
  });

  it("uses qq as a card query target alias", async () => {
    const result = await queryCard(
      { qq: "607972716", card: "summary" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                displayName: "Lucifer",
                displayNameCode: 8571,
                bungieName: "Lucifer#8571",
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/summary/3/4611686018428939884?mode=all");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              mode: "all",
              modeLabel: "总览",
              stats: {
                activities: 1,
                wins: 1,
                kills: 10,
                deaths: 2,
                assists: 1,
                secondsPlayed: 300,
                winRate: 100,
                kd: 5,
                kda: 5.25,
                efficiency: 5.5,
              },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /Lucifer#8571/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "summary");
  });

  it("uses sender QQ for command-only raid queries and returns a bind link when unbound", async () => {
    const calls = [];
    const result = await queryCard(
      { senderQq: "99887766", command: "查下raid" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init) => {
          calls.push(String(url));
          if (String(url).includes("/bindings/qq/oauth/start")) {
            assert.equal(init.method, "POST");
            assert.deepEqual(JSON.parse(init.body), { qq: "99887766" });
            return jsonResponse({
              success: true,
              data: {
                bindUrl: "http://d2.local/bind",
                message: "请在3分钟之内访问该链接进行绑定\nhttp://d2.local/bind\n\n该链接🔗被腾讯标识为危险网站",
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/bindings/qq/99887766");
          return jsonResponse(
            { success: false, data: null, error: { code: "NOT_FOUND", message: "qq binding was not found" } },
            404,
          );
        },
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /请在3分钟之内访问该链接进行绑定/);
    assert.equal(result.details.status, "ok");
    assert.equal(result.details.kind, "oauth_bind_link");
    assert.deepEqual(calls, [
      "http://d2.local/api/d2/bindings/qq/99887766",
      "http://d2.local/api/d2/bindings/qq/oauth/start",
    ]);
  });

  it("returns actionable guidance when a non-help command has no target", async () => {
    const result = await queryCard({ command: "/地牢" }, { baseUrl: "http://d2.local" });

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /这条命令缺少查询目标/);
    assert.match(result.content[0].text, /\/地牢 1665240495/);
  });

  it("routes command aliases to activity history cards", async () => {
    const result = await queryCard(
      { target: "3:4611686018428939884", command: "/最近", mode: "raid" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          assert.equal(String(url), "http://d2.local/api/d2/activities/3/4611686018428939884?mode=raid&count=18&page=0");
          return jsonResponse({
            success: true,
            data: [
              {
                period: "2026-06-03T00:00:00.000Z",
                activityId: "1234567890",
                activityName: "玻璃拱顶",
                modeName: "突袭",
                values: {
                  completed: { basic: { value: 1 } },
                  kills: { basic: { value: 100 } },
                  deaths: { basic: { value: 5 } },
                  killsDeathsRatio: { basic: { value: 20 } },
                  activityDurationSeconds: { basic: { value: 1800 } },
                },
              },
            ],
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 ACTIVITY HISTORY/);
          assert.match(html, /玻璃拱顶/);
          assert.match(html, /已完成/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "activities");
  });

  it("routes expanded command aliases to dedicated cards", async () => {
    const calls = [];
    const result = await queryCard(
      { target: "3:4611686018428939884", command: "/地牢", historyPages: 2 },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              mode: "dungeon",
              modeLabel: "地牢",
              totals: {
                activities: 1,
                dungeons: 1,
                clears: 2,
                fullClears: 2,
                completions: 2,
                sherpaCompletions: 0,
                kills: 50,
                deaths: 5,
                secondsPlayed: 1800,
                fastestCompletionDisplay: "15:00.000",
              },
              activities: [
                {
                  name: "二象性",
                  displayName: "二象性：普通",
                  difficulty: "normal",
                  difficultyLabel: "普通",
                  activityHashes: [1],
                  clears: 2,
                  fullClears: 2,
                  completions: 2,
                  wins: 2,
                  kills: 50,
                  deaths: 5,
                  secondsPlayed: 1800,
                  fastestCompletionDisplay: "15:00.000",
                  scannedCompletions: 1,
                  sherpaCompletions: 0,
                  fireteamSizes: { solo: 1, duo: 0, trio: 0 },
                  tags: ["Flawless Solo"],
                  flawless: { status: "confirmed", personal: true, fireteam: true },
                },
              ],
              dungeons: [
                {
                  name: "二象性",
                  displayName: "二象性：普通",
                  difficulty: "normal",
                  difficultyLabel: "普通",
                  activityHashes: [1],
                  clears: 2,
                  fullClears: 2,
                  completions: 2,
                  wins: 2,
                  kills: 50,
                  deaths: 5,
                  secondsPlayed: 1800,
                  fastestCompletionDisplay: "15:00.000",
                  scannedCompletions: 1,
                  sherpaCompletions: 0,
                  fireteamSizes: { solo: 1, duo: 0, trio: 0 },
                  tags: ["Flawless Solo"],
                  flawless: { status: "confirmed", personal: true, fireteam: true },
                },
              ],
              scan: { historyPages: 2, pgcrLimit: 50, pgcrScanned: 1 },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html, options) => {
          assert.equal(options.width, 1200);
          assert.match(html, /DESTINY 2 DUNGEON OVERVIEW/);
          assert.match(html, /二象性/);
          assert.match(html, /Flawless Solo/);
          assert.match(html, /地牢全程次数/);
          assert.match(html, /担任导师次数/);
          assert.match(html, /<strong>0<\/strong>/);
          assert.doesNotMatch(html, /未公开/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/dungeons/3/4611686018428939884?historyPages=2&pgcrLimit=50",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "dungeon_overview");
  });

  it("renders grandmaster cards from public JSON", async () => {
    const calls = [];
    const result = await queryCard(
      { target: "607972716", command: "/宗师", historyPages: 10, pgcrLimit: 50, season: "current" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: {
                  bungieName: "Lucifer#8571",
                  displayName: "Lucifer",
                  displayNameCode: 8571,
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/grandmasters/3/4611686018428939884?historyPages=10&pgcrLimit=50&season=current");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              season: { scope: "current", currentSeasonName: "赛季：回响", currentSeasonReliable: true },
              totals: {
                strikes: 1,
                currentSeasonClears: 2,
                lifetimeClears: 5,
                attempts: 3,
                completions: 5,
                kills: 300,
                deaths: 10,
                secondsPlayed: 7200,
                fastestCompletionDisplay: "20m 00s",
                averageCompletionSeconds: 1440,
              },
              strikes: [
                {
                  name: "洞悉终界",
                  activityHashes: [7001],
                  currentSeasonClears: 2,
                  lifetimeClears: 5,
                  attempts: 3,
                  completions: 5,
                  kills: 300,
                  deaths: 10,
                  secondsPlayed: 7200,
                  fastestCompletionDisplay: "20m 00s",
                  averageCompletionSeconds: 1440,
                  completionRate: 66.67,
                },
              ],
              recent: [
                {
                  activityId: "990",
                  activityName: "洞悉终界",
                  period: "2026-06-03T00:00:00.000Z",
                  completed: true,
                  durationSeconds: 1200,
                  kills: 120,
                  deaths: 3,
                  assists: 30,
                  players: [
                    {
                      displayName: "Lucifer#8571",
                      kills: 50,
                      deaths: 1,
                      assists: 6,
                      kd: 50,
                      completed: true,
                      weapons: [{ referenceId: "99", name: "Wish-Ender", kills: 30, precisionKills: 0, secondsUsed: 0 }],
                    },
                  ],
                },
              ],
              scan: { note: "宗师测试", historyPages: 10, pgcrLimit: 50, pgcrScanned: 1 },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 GRANDMASTERS/);
          assert.match(html, /Lucifer#8571/);
          assert.match(html, /洞悉终界/);
          assert.match(html, /最近宗师队伍/);
          assert.match(html, /Wish-Ender/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/grandmasters/3/4611686018428939884?historyPages=10&pgcrLimit=50&season=current",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "grandmasters");
  });

  it("renders heatmap cards from public JSON", async () => {
    const calls = [];
    const result = await queryCard(
      { target: "3:4611686018428939884", command: "/热力图", mode: "all", pages: 2 },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
                profile: {
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/heatmap/3/4611686018428939884?mode=all&range=all&timezone=Asia%2FShanghai");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              mode: "all",
              modeLabel: "全部",
              timezone: "Asia/Shanghai",
              range: "all",
              activitiesScanned: 2,
              days: [
                { key: "2026-06-02", activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 },
                { key: "2026-06-03", activities: 1, completed: 1, kills: 20, deaths: 2, secondsPlayed: 200 },
              ],
              hours: [{ key: "20", activities: 2, completed: 2, kills: 30, deaths: 3, secondsPlayed: 300 }],
              calendar: [
                {
                  year: 2026,
                  totals: { key: "2026", activities: 2, completed: 2, kills: 30, deaths: 3, secondsPlayed: 300 },
                  months: [
                    {
                      key: "2026-06",
                      year: 2026,
                      month: 6,
                      label: "2026年6月",
                      firstWeekday: 0,
                      daysInMonth: 30,
                      totals: { key: "2026-06", activities: 2, completed: 2, kills: 30, deaths: 3, secondsPlayed: 300 },
                      days: [
                        { key: "2026-06-02", date: "2026-06-02", day: 2, weekday: 1, week: 0, intensity: 4, activities: 1, completed: 1, kills: 10, deaths: 1, secondsPlayed: 100 },
                        { key: "2026-06-03", date: "2026-06-03", day: 3, weekday: 2, week: 0, intensity: 4, activities: 1, completed: 1, kills: 20, deaths: 2, secondsPlayed: 200 },
                      ],
                    },
                  ],
                },
              ],
              scan: { range: "all", pagesPerCharacter: 2, maxPagesPerCharacter: 100, truncated: false, note: "已扫描到公开活动历史空页" },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 ACTIVITY HEATMAP/);
          assert.match(html, /Lucifer#8571/);
          assert.match(html, /2026年6月/);
          assert.match(html, /ID 3:4611686018428939884/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/heatmap/3/4611686018428939884?mode=all&range=all&timezone=Asia%2FShanghai",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "heatmap");
  });

  it("renders crafting cards from public JSON", async () => {
    const calls = [];
    const result = await queryCard(
      { target: "3:4611686018428939884", command: "/锻造" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: {
                  bungieName: "Lucifer#8571",
                  displayName: "Lucifer",
                  displayNameCode: 8571,
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/craftables/3/4611686018428939884");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              totals: { groups: 1, weapons: 2, unlocked: 1, locked: 1 },
              groups: [
                {
                  key: "突袭",
                  name: "突袭",
                  total: 2,
                  unlocked: 1,
                  locked: 1,
                  items: [
                    { itemHash: "101", name: "纪念", iconPath: "/icon1.jpg", itemTypeDisplayName: "机枪", groupName: "突袭", visible: true, unlocked: true, failedRequirementIndexes: [], requirementCount: 0, socketCount: 8 },
                    { itemHash: "102", name: "信任", iconPath: "/icon2.jpg", itemTypeDisplayName: "手炮", groupName: "突袭", visible: true, unlocked: false, failedRequirementIndexes: [0], requirementCount: 1, socketCount: 8 },
                  ],
                },
              ],
              scan: { characterCount: 1, rootNodeHash: "900", note: "分组来自 Bungie 锻造 PresentationNode" },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 CRAFTING/);
          assert.match(html, /Lucifer#8571/);
          assert.match(html, /纪念/);
          assert.match(html, /信任/);
          assert.match(html, /可锻造/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/craftables/3/4611686018428939884",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "crafting");
  });

  it("renders catalyst cards for QQ OAuth targets", async () => {
    const calls = [];
    const result = await queryCard(
      { target: "607972716", command: "/催化" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: {
                  bungieName: "Lucifer#8571",
                  displayName: "Lucifer",
                  displayNameCode: 8571,
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/catalysts/qq/607972716");
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              totals: { groups: 1, catalysts: 2, completed: 1, incomplete: 1, visible: 2 },
              groups: [
                {
                  key: "power",
                  name: "威能武器",
                  total: 2,
                  completed: 1,
                  incomplete: 1,
                  items: [
                    {
                      recordHash: "700",
                      weaponHash: "201",
                      name: "纪念",
                      iconPath: "/icon1.jpg",
                      itemTypeDisplayName: "机枪",
                      slot: "power",
                      slotLabel: "威能武器",
                      completed: false,
                      redeemed: false,
                      visible: true,
                      percent: 50,
                      progress: 50,
                      completionValue: 100,
                      objectives: [{ objectiveHash: "9001", progress: 50, completionValue: 100, complete: false }],
                    },
                    {
                      recordHash: "701",
                      name: "赴险者",
                      itemTypeDisplayName: "微型冲锋枪",
                      slot: "energy",
                      slotLabel: "能量武器",
                      completed: true,
                      redeemed: true,
                      visible: true,
                      percent: 100,
                      progress: 100,
                      completionValue: 100,
                      objectives: [{ objectiveHash: "9002", progress: 100, completionValue: 100, complete: true }],
                    },
                  ],
                },
              ],
              scan: { note: "催化进度来自 Bungie OAuth Profile Records/Collectibles。" },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 CATALYSTS/);
          assert.match(html, /Lucifer#8571/);
          assert.match(html, /催化进度/);
          assert.match(html, /纪念/);
          assert.match(html, /赴险者/);
          assert.match(html, /50 \/ 100/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/catalysts/qq/607972716",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "catalysts");
  });

  it("does not query catalysts by public Bungie membership targets", async () => {
    const result = await queryCard(
      { target: "3:4611686018428939884", card: "catalysts" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () => {
          throw new Error("catalyst query should reject before backend fetch");
        },
        renderHtmlToPng: async () => Buffer.from("should-not-render"),
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /催化进度需要 QQ OAuth 授权/);
  });

  it("supports direct activity PGCR rendering", async () => {
    const result = await queryCard(
      { target: "1234567890", card: "activity" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          assert.equal(String(url), "http://d2.local/api/d2/pgcr/1234567890");
          return jsonResponse({
            success: true,
            data: {
              activityId: "1234567890",
              activityName: "玻璃拱顶",
              modeName: "突袭",
              period: "2026-06-03T00:00:00.000Z",
              players: [{ displayName: "Lucifer", kills: 10, deaths: 1, assists: 2, kd: 10, completed: true }],
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 ACTIVITY/);
          assert.match(html, /Lucifer/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
  });

  it("uses the latest completed activity for latest_activity cards", async () => {
    const result = await queryCard(
      { target: "3:4611686018428939884", card: "latest_activity", mode: "raid" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          if (String(url).includes("/activities/")) {
            assert.equal(String(url), "http://d2.local/api/d2/activities/3/4611686018428939884?mode=raid&count=25&page=0");
            return jsonResponse({
              success: true,
              data: [
                {
                  activityId: "1001",
                  values: { completed: { basic: { value: 0 } } },
                },
                {
                  activityId: "1002",
                  values: { completed: { basic: { value: 1 } } },
                },
              ],
            });
          }
          assert.equal(String(url), "http://d2.local/api/d2/pgcr/1002");
          return jsonResponse({
            success: true,
            data: {
              activityId: "1002",
              activityName: "完成的突袭",
              modeName: "突袭",
              period: "2026-06-03T00:00:00.000Z",
              players: [{ displayName: "Lucifer", kills: 10, deaths: 1, assists: 2, kd: 10, completed: true }],
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /完成的突袭/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
  });

  it("returns a friendly text result for unbound QQ", async () => {
    const seenUrls = [];
    const result = await queryCard(
      { target: "607972716", card: "summary" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/oauth/start")) {
            assert.equal(init.method, "POST");
            assert.deepEqual(JSON.parse(init.body), { qq: "607972716" });
            return jsonResponse({
              success: true,
              data: {
                message: "请在3分钟之内访问该链接进行绑定\nhttp://d2.local/bind\n\n该链接🔗被腾讯标识为危险网站",
              },
            });
          }
          return jsonResponse(
            {
              success: false,
              error: { code: "NOT_FOUND", message: "qq binding was not found" },
            },
            404,
          );
        },
        renderHtmlToPng: async () => Buffer.from("should-not-render"),
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /请在3分钟之内访问该链接进行绑定/);
    assert.equal(result.details.status, "ok");
    assert.equal(result.details.kind, "oauth_bind_link");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/bindings/qq/oauth/start",
    ]);
  });

  it("binds QQ through the public API", async () => {
    const result = await bindQq(
      { qq: "607972716", target: "DLIVX#411" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (_url, init) => {
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { qq: "607972716", bungieName: "DLIVX#411" });
          return jsonResponse({
            success: true,
            data: { qq: "607972716", membershipType: 3, membershipId: "4611686018428939884" },
          });
        },
      },
    );

    assert.match(result.content[0].text, /绑定成功/);
  });

  it("renders inventory query cards for QQ OAuth targets", async () => {
    const seenUrls = [];
    const result = await queryInventory(
      { target: "607972716", q: "纪念" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              query: "纪念",
              items: [
                {
                  itemHash: 101,
                  itemInstanceId: "691752902764",
                  owner: "vault",
                  name: "纪念",
                  bucketName: "一般",
                  itemTypeDisplayName: "微型冲锋枪",
                  locked: true,
                  canEquip: true,
                  sockets: [
                    {
                      socketIndex: 0,
                      name: "插槽 1",
                      selectedPlug: { itemHash: 9001, name: "重建", selected: true },
                      reusablePlugs: [
                        { itemHash: 9001, name: "重建", selected: true },
                        { itemHash: 9002, name: "不稳定弹药", selected: false },
                      ],
                    },
                  ],
                },
              ],
              total: 1,
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 INVENTORY/);
          assert.match(html, /纪念/);
          assert.match(html, /691752902764/);
          assert.match(html, /inventory-selected-perks/);
          assert.match(html, /重建/);
          assert.doesNotMatch(html, /不稳定弹药/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/inventory/qq/607972716/search?q=%E7%BA%AA%E5%BF%B5&bucket=all",
    ]);
  });

  it("uses qq as an inventory query target alias", async () => {
    const seenUrls = [];
    const result = await queryInventory(
      { qq: "607972716", view: "equipped", bucket: "equipped" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              updatedAt: "2026-06-05T00:00:00.000Z",
              characters: [],
              items: [
                { itemHash: 201, itemInstanceId: "691752902801", owner: "equipped", bucketName: "动能武器", name: "翼狼", itemTypeDisplayName: "自动步枪" },
              ],
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 EQUIPPED/);
          assert.match(html, /翼狼/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "inventory:equipped");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/inventory/qq/607972716",
    ]);
  });

  it("returns an OAuth binding link for unbound inventory QQ aliases", async () => {
    const seenUrls = [];
    const result = await queryInventory(
      { qq: "607972716", view: "vault", bucket: "vault" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/oauth/start")) {
            assert.equal(init.method, "POST");
            assert.deepEqual(JSON.parse(init.body), { qq: "607972716" });
            return jsonResponse({
              success: true,
              data: {
                message: "请在3分钟之内访问该链接进行绑定\nhttp://d2.local/bind\n\n该链接🔗被腾讯标识为危险网站",
              },
            });
          }
          return jsonResponse(
            {
              success: false,
              error: { code: "NOT_FOUND", message: "qq binding was not found" },
            },
            404,
          );
        },
        renderHtmlToPng: async () => Buffer.from("should-not-render"),
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /请在3分钟之内访问该链接进行绑定/);
    assert.equal(result.details.status, "ok");
    assert.equal(result.details.kind, "oauth_bind_link");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/bindings/qq/oauth/start",
    ]);
  });

  it("renders full vault inventory as a dedicated long card", async () => {
    const seenUrls = [];
    const result = await queryInventory(
      { target: "607972716", view: "vault", bucket: "vault" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              updatedAt: "2026-06-05T00:00:00.000Z",
              totals: { items: 4, vault: 2, inventory: 1, equipped: 1 },
              characters: [],
              items: [
                {
                  itemHash: 101,
                  itemInstanceId: "691752902764",
                  owner: "vault",
                  bucketName: "威能武器",
                  name: "纪念",
                  itemTypeDisplayName: "机枪",
                  locked: true,
                  canEquip: true,
                  sockets: [
                    {
                      socketIndex: 0,
                      name: "插槽 1",
                      selectedPlug: { itemHash: 9001, name: "重建", selected: true },
                      reusablePlugs: [
                        { itemHash: 9001, name: "重建", selected: true },
                        { itemHash: 9002, name: "杀戮弹匣", selected: false },
                      ],
                    },
                  ],
                },
                {
                  itemHash: 102,
                  itemInstanceId: "691752902765",
                  owner: "vault",
                  bucketName: "头盔",
                  name: "条件终局",
                  itemTypeDisplayName: "术士头盔",
                  locked: false,
                  canEquip: true,
                  armorStats: {
                    total: 68,
                    stats: [
                      { hash: 2996146975, name: "机动", value: 2 },
                      { hash: 392767087, name: "韧性", value: 30 },
                      { hash: 1943323491, name: "恢复", value: 18 },
                      { hash: 1735777505, name: "纪律", value: 10 },
                      { hash: 144602215, name: "智慧", value: 2 },
                      { hash: 4244567218, name: "力量", value: 6 },
                    ],
                  },
                },
                { itemHash: 103, itemInstanceId: "691752902766", owner: "inventory", bucketName: "动能武器", name: "背包物品", itemTypeDisplayName: "手炮", locked: false, canEquip: true },
                { itemHash: 104, itemInstanceId: "691752902767", owner: "equipped", bucketName: "能量武器", name: "已装备物品", itemTypeDisplayName: "弓", locked: false, canEquip: true },
              ],
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 VAULT/);
          assert.match(html, /仓库全量/);
          assert.match(html, /纪念/);
          assert.match(html, /条件终局/);
          assert.match(html, /重建/);
          assert.doesNotMatch(html, /杀戮弹匣/);
          assert.match(html, /防具属性/);
          assert.match(html, /韧性/);
          assert.match(html, /68/);
          assert.doesNotMatch(html, /背包物品/);
          assert.doesNotMatch(html, /已装备物品/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "inventory:vault");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/inventory/qq/607972716",
    ]);
  });

  it("splits large vault inventory into paged images", async () => {
    const renderedPages = [];
    const vaultItems = Array.from({ length: 85 }, (_, index) => ({
      itemHash: 5000 + index,
      itemInstanceId: `69175290${String(index).padStart(4, "0")}`,
      owner: "vault",
      bucketName: index % 2 === 0 ? "动能武器" : "头盔",
      name: `仓库物品${index + 1}`,
      itemTypeDisplayName: index % 2 === 0 ? "自动步枪" : "术士头盔",
      locked: index % 3 === 0,
      canEquip: true,
    }));
    const result = await queryInventory(
      { qq: "607972716", view: "vault", bucket: "vault", pageSize: 40 },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              updatedAt: "2026-06-05T00:00:00.000Z",
              totals: { items: vaultItems.length, vault: vaultItems.length, inventory: 0, equipped: 0 },
              characters: [],
              items: vaultItems,
            },
          });
        },
        renderHtmlToPng: async (html) => {
          renderedPages.push(html);
          assert.match(html, /DESTINY 2 VAULT/);
          assert.match(html, /仓库全量/);
          assert.match(html, /仓库总数/);
          return Buffer.from(`png-page-${renderedPages.length}`);
        },
      },
    );

    assert.equal(result.content.length, 3);
    assert.equal(result.content.every((part) => part.type === "image"), true);
    assert.equal(result.details.imageCount, 3);
    assert.match(renderedPages[0], /第 1\/3 页/);
    assert.match(renderedPages[1], /第 2\/3 页/);
    assert.match(renderedPages[2], /第 3\/3 页/);
  });

  it("returns a share page link for oversized inventory output when configured", async () => {
    const vaultItems = Array.from({ length: 85 }, (_, index) => ({
      itemHash: 6000 + index,
      itemInstanceId: `69175291${String(index).padStart(4, "0")}`,
      owner: "vault",
      bucketName: "动能武器",
      name: `仓库物品${index + 1}`,
      itemTypeDisplayName: "自动步枪",
      locked: true,
      canEquip: true,
    }));
    const shareUploads = [];
    const result = await queryInventory(
      { qq: "607972716", view: "vault", bucket: "vault", pageSize: 40 },
      {
        baseUrl: "http://d2.local",
        shareUploadToken: "share-token",
        shareImageCountThreshold: 2,
      },
      {
        fetchImpl: async (url, init = {}) => {
          if (String(url).includes("/api/d2/share-pages")) {
            assert.equal(init.method, "POST");
            assert.equal(init.headers.authorization, "Bearer share-token");
            const payload = JSON.parse(init.body);
            shareUploads.push(payload);
            assert.equal(payload.images, undefined);
            assert.equal(payload.htmlPages.length, 3);
            assert.match(payload.htmlPages[0].html, /<!doctype html>/i);
            assert.doesNotMatch(payload.htmlPages[0].html, /data:font\/ttf;base64/);
            assert.match(payload.title, /仓库/);
            return jsonResponse({
              success: true,
              data: {
                id: "shareid",
                url: "https://www.luciferfore.com/share/shareid/index.html",
                pageCount: 3,
                imageCount: 3,
                bytes: 3072,
              },
            });
          }
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              updatedAt: "2026-06-05T00:00:00.000Z",
              totals: { items: vaultItems.length, vault: vaultItems.length, inventory: 0, equipped: 0 },
              characters: [],
              items: vaultItems,
            },
          });
        },
        renderHtmlToPng: async () => Buffer.alloc(1024, 7),
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /https:\/\/www\.luciferfore\.com\/share\/shareid\/index\.html/);
    assert.match(result.content[0].text, /网页布局版/);
    assert.match(result.content[0].text, /放大也不会糊/);
    assert.equal(result.details.kind, "share_page");
    assert.equal(result.details.pageCount, 3);
    assert.equal(result.details.imageCount, 3);
    assert.equal(shareUploads.length, 1);
  });

  it("renders equipped inventory grouped by character", async () => {
    const seenUrls = [];
    const result = await queryInventory(
      { target: "607972716", view: "equipped", bucket: "equipped" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { characters: [] },
              },
            });
          }
          return jsonResponse({
            success: true,
            data: {
              membershipType: 3,
              membershipId: "4611686018428939884",
              updatedAt: "2026-06-05T00:00:00.000Z",
              characters: [
                { characterId: "2305843001", className: "术士", light: 13, dateLastPlayed: "2026-06-05T00:00:00.000Z" },
                { characterId: "2305843002", className: "猎人", light: 15, dateLastPlayed: "2026-06-04T00:00:00.000Z" },
              ],
              items: [
                {
                  itemHash: 201,
                  itemInstanceId: "691752902801",
                  owner: "equipped",
                  characterId: "2305843001",
                  bucketName: "动能武器",
                  name: "翼狼",
                  itemTypeDisplayName: "自动步枪",
                  locked: true,
                  canEquip: true,
                  sockets: [
                    {
                      socketIndex: 0,
                      selectedPlug: { itemHash: 9010, name: "禅意时刻", selected: true },
                      reusablePlugs: [
                        { itemHash: 9010, name: "禅意时刻", selected: true },
                        { itemHash: 9011, name: "斩首武器", selected: false },
                      ],
                    },
                  ],
                },
                {
                  itemHash: 202,
                  itemInstanceId: "691752902802",
                  owner: "equipped",
                  characterId: "2305843002",
                  bucketName: "胸甲",
                  name: "不散恐惧",
                  itemTypeDisplayName: "猎人护甲",
                  energyCapacity: 10,
                  energyUsed: 6,
                  armorStats: {
                    total: 64,
                    stats: [
                      { hash: 2996146975, name: "机动", value: 10 },
                      { hash: 392767087, name: "韧性", value: 20 },
                      { hash: 1943323491, name: "恢复", value: 8 },
                      { hash: 1735777505, name: "纪律", value: 12 },
                      { hash: 144602215, name: "智慧", value: 6 },
                      { hash: 4244567218, name: "力量", value: 8 },
                    ],
                  },
                },
                { itemHash: 203, itemInstanceId: "691752902803", owner: "vault", bucketName: "威能武器", name: "纪念", itemTypeDisplayName: "机枪" },
              ],
            },
          });
        },
        renderHtmlToPng: async (html, options) => {
          assert.equal(options.width, 1920);
          assert.match(html, /DESTINY 2 EQUIPPED/);
          assert.match(html, /当前装备/);
          assert.match(html, /equipped-wide-list/);
          assert.match(html, /术士/);
          assert.match(html, /猎人/);
          assert.match(html, /翼狼/);
          assert.match(html, /不散恐惧/);
          assert.match(html, /禅意时刻/);
          assert.doesNotMatch(html, /斩首武器/);
          assert.match(html, /总 64/);
          assert.match(html, /力 8/);
          assert.doesNotMatch(html, /纪念/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "inventory:equipped");
    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/inventory/qq/607972716",
    ]);
  });

  it("requires confirmation before item actions execute", async () => {
    let called = false;
    const result = await itemAction(
      {
        target: "607972716",
        action: "equip",
        itemId: "691752902764",
        characterId: "2305843009",
      },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () => {
          called = true;
          return jsonResponse({ success: true, data: {} });
        },
      },
    );

    assert.equal(called, false);
    assert.equal(result.details.status, "confirmation_required");
    assert.match(result.content[0].text, /confirm=true/);
  });

  it("asks for class before loadout optimization", async () => {
    let called = false;
    const result = await queryLoadoutOptimizer(
      { target: "607972716" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () => {
          called = true;
          return jsonResponse({ success: true, data: {} });
        },
      },
    );

    assert.equal(called, false);
    assert.equal(result.details.status, "needs_class");
    assert.match(result.content[0].text, /术士、猎人或泰坦/);
  });

  it("renders loadout optimizer results from QQ OAuth data", async () => {
    const seenUrls = [];
    const result = await queryLoadoutOptimizer(
      { target: "607972716", className: "术士", targetStats: { recovery: 100, discipline: 100, strength: 100 } },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init = {}) => {
          seenUrls.push(String(url));
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: {
                  bungieName: "Lucifer#8571",
                  displayName: "Lucifer",
                  displayNameCode: 8571,
                  characters: [
                    {
                      className: "Warlock",
                      light: 2020,
                      dateLastPlayed: "2026-06-03T00:00:00.000Z",
                      emblemPath: "/common/destiny2_content/icons/current-icon.jpg",
                      emblemBackgroundPath: "/common/destiny2_content/icons/current-card.jpg",
                    },
                  ],
                },
              },
            });
          }
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), {
            className: "术士",
            targetStats: { recovery: 100, discipline: 100, strength: 100 },
            includeCurrentSubclassFragments: true,
            simulateStatMods: true,
            limit: 3,
          });
          return jsonResponse({
            success: true,
            data: {
              qq: "607972716",
              membershipType: 3,
              membershipId: "4611686018428939884",
              sessionId: "session-1",
              className: "术士",
              classType: 2,
              characterId: "2305843009",
              targets: [
                { key: "recovery", statKey: "recovery", statHash: 1943323491, statName: "恢复", target: 100 },
                { key: "discipline", statKey: "discipline", statHash: 1735777505, statName: "纪律", target: 100 },
                { key: "strength", statKey: "strength", statHash: 4244567218, statName: "力量", target: 100 },
              ],
              options: { includeCurrentSubclassFragments: true, simulateStatMods: true, limit: 3 },
              builds: [
                {
                  buildId: "b1",
                  rank: 1,
                  achieved: true,
                  score: 0,
                  waste: 0,
                  missing: [],
                  stats: [
                    { key: "recovery", statKey: "recovery", statHash: 1943323491, statName: "恢复", value: 100 },
                    { key: "discipline", statKey: "discipline", statHash: 1735777505, statName: "纪律", value: 100 },
                    { key: "strength", statKey: "strength", statHash: 4244567218, statName: "力量", value: 100 },
                  ],
                  armor: [
                    {
                      slot: "helmet",
                      slotLabel: "头盔",
                      itemHash: 401,
                      itemInstanceId: "691752903001",
                      name: "配装头盔",
                      iconPath: "/helmet.jpg",
                      owner: "vault",
                      tierTypeName: "传说",
                      exotic: false,
                      baseStats: [{ key: "recovery", statKey: "recovery", statName: "恢复", value: 20 }],
                      currentStats: [],
                      removedStatMods: [],
                    },
                  ],
                  statMods: [{ statHash: 1943323491, statKey: "recovery", statName: "恢复", value: 10, count: 2 }],
                  fragments: [{ socketIndex: 3, name: "慰藉余烬", statModifiers: [{ hash: 1735777505, name: "纪律", value: 10 }] }],
                  notes: ["属性模组和碎片需要手动调整"],
                },
              ],
              scan: { armorItems: 5, candidateArmorItems: 5, armorCombinations: 1, fragmentCombinations: 1, truncated: false },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 LOADOUT OPTIMIZER/);
          assert.match(html, /Lucifer#8571/);
          assert.match(html, /session-1/);
          assert.match(html, /第 1 套/);
          assert.match(html, /配装头盔/);
          assert.match(html, /恢复 \+10（2 个）/);
          assert.match(html, /慰藉余烬/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/loadout-optimizer/qq/607972716/search",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.sessionId, "session-1");
  });

  it("does not add default strength when explicit loadout target stats are provided", async () => {
    const result = await queryLoadoutOptimizer(
      { target: "607972716", className: "术士", targetStats: { resilience: 100, recovery: 100, discipline: 100 } },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init = {}) => {
          if (String(url).includes("/bindings/qq/")) {
            return jsonResponse({
              success: true,
              data: {
                qq: "607972716",
                membershipType: 3,
                membershipId: "4611686018428939884",
                bungieName: "Lucifer#8571",
                displayName: "Lucifer",
                displayNameCode: 8571,
              },
            });
          }
          if (String(url).includes("/namecard/")) {
            return jsonResponse({
              success: true,
              data: {
                membershipType: 3,
                membershipId: "4611686018428939884",
                profile: { bungieName: "Lucifer#8571", characters: [] },
              },
            });
          }
          assert.deepEqual(JSON.parse(init.body), {
            className: "术士",
            targetStats: { resilience: 100, recovery: 100, discipline: 100 },
            includeCurrentSubclassFragments: true,
            simulateStatMods: true,
            limit: 3,
          });
          return jsonResponse({
            success: true,
            data: {
              qq: "607972716",
              membershipType: 3,
              membershipId: "4611686018428939884",
              sessionId: "session-explicit",
              className: "术士",
              targets: [
                { key: "resilience", statName: "韧性", target: 100 },
                { key: "recovery", statName: "恢复", target: 100 },
                { key: "discipline", statName: "纪律", target: 100 },
              ],
              builds: [],
              scan: {},
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /韧性 100 \+ 恢复 100 \+ 纪律 100/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.sessionId, "session-explicit");
  });

  it("requires confirmation before applying loadout optimizer builds", async () => {
    let called = false;
    const result = await applyLoadoutOptimizer(
      { target: "607972716", sessionId: "session-1", buildId: "b1" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () => {
          called = true;
          return jsonResponse({ success: true, data: {} });
        },
      },
    );

    assert.equal(called, false);
    assert.equal(result.details.status, "needs_confirmation");
    assert.match(result.content[0].text, /只会换防具/);
  });

  it("applies confirmed loadout optimizer builds", async () => {
    const result = await applyLoadoutOptimizer(
      { target: "607972716", sessionId: "session-1", buildId: "b1", confirm: true },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init = {}) => {
          assert.equal(String(url), "http://d2.local/api/d2/loadout-optimizer/qq/607972716/apply");
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { sessionId: "session-1", buildId: "b1", confirm: true });
          return jsonResponse({
            success: true,
            data: {
              message: "已应用配装防具",
              statMods: [{ statName: "恢复", value: 10, count: 2 }],
              fragments: [{ name: "慰藉余烬" }],
            },
          });
        },
      },
    );

    assert.equal(result.details.status, "ok");
    assert.match(result.content[0].text, /已应用配装防具/);
    assert.match(result.content[0].text, /属性模组/);
    assert.match(result.content[0].text, /碎片/);
  });

  it("starts OAuth binding when no Bungie target is provided", async () => {
    const result = await bindQq(
      { qq: "607972716" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init) => {
          assert.equal(String(url), "http://d2.local/api/d2/bindings/qq/oauth/start");
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { qq: "607972716" });
          return jsonResponse({
            success: true,
            data: {
              message: "请在3分钟之内访问该链接进行绑定\nhttp://d2.local/bind\n\n该链接🔗被腾讯标识为危险网站",
            },
          });
        },
      },
    );

    assert.equal(result.details.status, "ok");
    assert.equal(result.details.kind, "oauth_bind_link");
    assert.match(result.content[0].text, /http:\/\/d2\.local\/bind/);
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
