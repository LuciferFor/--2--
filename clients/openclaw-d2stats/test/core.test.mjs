import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bindQq, buildPublicDataUrl, parseTarget, queryCard, resolveConfig } from "../lib/core.mjs";

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
    assert.equal(dungeons, "http://d2.local/api/d2/dungeons/3/4611686018428939884?historyPages=3");

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
              totals: { activities: 1, clears: 2, kills: 50, deaths: 5, secondsPlayed: 1800 },
              activities: [
                {
                  name: "二象性",
                  activityHashes: [1],
                  clears: 2,
                  kills: 50,
                  deaths: 5,
                  secondsPlayed: 1800,
                  fastestCompletionDisplay: "15:00.000",
                },
              ],
              scan: { historyPages: 2 },
              updatedAt: "2026-06-03T00:00:00.000Z",
            },
          });
        },
        renderHtmlToPng: async (html) => {
          assert.match(html, /DESTINY 2 DUNGEON OVERVIEW/);
          assert.match(html, /二象性/);
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(calls, [
      "http://d2.local/api/d2/namecard/3/4611686018428939884",
      "http://d2.local/api/d2/dungeons/3/4611686018428939884?historyPages=2",
    ]);
    assert.equal(result.content[0].type, "image");
    assert.equal(result.details.card, "dungeon_overview");
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

    assert.equal(result.details.status, "oauth_bind_required");
    assert.match(result.content[0].text, /http:\/\/d2\.local\/bind/);
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
