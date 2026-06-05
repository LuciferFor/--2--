import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const bridge = require("../onebot/bridge-onebot-openclaw.cjs");

const event = {
  message_type: "private",
  user_id: "1665240495",
  self_id: "3793341814",
};

describe("onebot d2 direct bridge", () => {
  it("routes bare weapon type inventory queries to image search", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查询下我的冲锋枪");

    assert.equal(invocation.card, "inventory");
    assert.equal(invocation.target, "1665240495");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "冲锋枪",
      view: "search",
      bucket: "all",
    });
  });

  it("normalizes vault weapon aliases for inventory search", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查仓库所有微冲");

    assert.equal(invocation.card, "inventory");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "冲锋枪",
      view: "search",
      bucket: "vault",
    });
  });

  it("keeps equipped gear queries out of item search when no item type is present", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查我的术士装备");

    assert.equal(invocation.card, "inventory");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "",
      view: "equipped",
      bucket: "equipped",
    });
  });

  it("routes stat target suit queries to the loadout optimizer", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查下我的术士有没有能凑100纪律 100恢复 100韧性的套装");

    assert.equal(invocation.card, "loadout_optimizer");
    assert.equal(invocation.target, "1665240495");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      className: "warlock",
      targetStats: { resilience: 100, recovery: 100, discipline: 100 },
      includeCurrentSubclassFragments: true,
      simulateStatMods: true,
      limit: 3,
    });
  });

  it("keeps the default loadout optimizer target when no stats are named", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "我的术士配装");

    assert.equal(invocation.card, "loadout_optimizer");
    assert.deepEqual(invocation.params.targetStats, { recovery: 100, discipline: 100, strength: 100 });
  });

  it("recognizes image resend requests", () => {
    assert.equal(bridge.isD2DirectReplayRequest("发出来啊"), true);
    assert.equal(bridge.isD2DirectReplayRequest("图呢"), true);
    assert.equal(bridge.isD2DirectReplayRequest("随便聊一句"), false);
  });
});
