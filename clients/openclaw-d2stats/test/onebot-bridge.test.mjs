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
      q: "",
      weaponType: "冲锋枪",
      view: "search",
      bucket: "all",
    });
  });

  it("normalizes vault weapon aliases for inventory search", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查仓库所有微冲");

    assert.equal(invocation.card, "inventory");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "",
      weaponType: "冲锋枪",
      view: "search",
      bucket: "vault",
    });
  });

  it("extracts structured rpm and weapon type from natural inventory queries", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查下我的仓库里的120射速手炮");

    assert.equal(invocation.card, "inventory");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "",
      weaponType: "手炮",
      rpm: 120,
      view: "search",
      bucket: "vault",
    });
  });

  it("understands english rpm and weapon type aliases", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查我的120rpm hc");

    assert.equal(invocation.card, "inventory");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "",
      weaponType: "手炮",
      rpm: 120,
      view: "search",
      bucket: "all",
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
    const invocation = bridge.buildD2DirectInvocation(event, "查下我的术士有没有能凑100手雷 100职业 100生命值的套装");

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

  it("does not invent default loadout optimizer targets when no stats are named", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "我的术士配装");

    assert.equal(invocation.card, "loadout_optimizer");
    assert.deepEqual(invocation.params.targetStats, {});
  });

  it("accepts legacy loadout stat words as aliases", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查下我的术士有没有能凑100纪律 100恢复 100韧性的套装");

    assert.equal(invocation.card, "loadout_optimizer");
    assert.deepEqual(invocation.params.targetStats, { resilience: 100, recovery: 100, discipline: 100 });
  });

  it("recognizes image resend requests", () => {
    assert.equal(bridge.isD2DirectReplayRequest("发出来啊"), true);
    assert.equal(bridge.isD2DirectReplayRequest("图呢"), true);
    assert.equal(bridge.isD2DirectReplayRequest("随便聊一句"), false);
  });

  it("does not trim OAuth binding links in group replies", () => {
    const message = [
      "请在3分钟之内访问该链接进行绑定",
      "https://www.luciferfore.com/api/d2/bind/0123456789abcdef",
      "",
      "如果 QQ 内无法打开，请复制上面这一整行到外部浏览器打开。"
    ].join("\n");

    assert.equal(bridge.shouldSendFullGroupReply(message, {}), true);
    assert.doesNotMatch(message, /\.{3}|…/u);
    assert.match(bridge.trimGroupReply("这是一段没有链接也不是命运2业务结果的很长很长普通群聊回复".repeat(4)), /…$/u);
  });
});
