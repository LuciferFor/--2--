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

  it("recognizes image resend requests", () => {
    assert.equal(bridge.isD2DirectReplayRequest("发出来啊"), true);
    assert.equal(bridge.isD2DirectReplayRequest("图呢"), true);
    assert.equal(bridge.isD2DirectReplayRequest("随便聊一句"), false);
  });
});
