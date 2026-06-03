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
          return Buffer.from("png-bytes");
        },
      },
    );

    assert.deepEqual(seenUrls, [
      "http://d2.local/api/d2/bindings/qq/607972716",
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

  it("returns a friendly text result for unbound QQ", async () => {
    const result = await queryCard(
      { target: "607972716", card: "summary" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async () =>
          jsonResponse(
            {
              success: false,
              error: { code: "NOT_FOUND", message: "qq binding was not found" },
            },
            404,
          ),
        renderHtmlToPng: async () => Buffer.from("should-not-render"),
      },
    );

    assert.equal(result.content[0].type, "text");
    assert.match(result.content[0].text, /未绑定/);
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
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
