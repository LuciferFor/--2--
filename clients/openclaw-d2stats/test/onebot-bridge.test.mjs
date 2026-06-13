import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { executeD2CommandEnvelope } from "../lib/command-gateway.mjs";

const require = createRequire(import.meta.url);
const bridge = require("../onebot/bridge-onebot-openclaw.cjs");
const commands = require("../lib/commands.cjs");

const event = {
  message_type: "private",
  user_id: "1665240495",
  self_id: "3793341814",
};

describe("onebot d2 direct bridge", () => {
  it("parses command-gateway help commands", () => {
    const invocation = commands.parseCommandLine("--help", { senderQq: "1665240495" });

    assert.equal(invocation.card, "help");
    assert.equal(invocation.command, "help");
    assert.match(commands.commandHelpText(), /--raid/u);
    assert.match(commands.commandHelpText(), /--item/u);
    assert.match(commands.commandHelpText(), /\/d2help/u);
  });

  it("parses non-conflicting d2 help aliases", () => {
    const slash = commands.parseCommandLine("/d2help", { senderQq: "1665240495" });
    const natural = commands.buildCommandInvocationFromText(event, "命运2帮助");

    assert.equal(slash.card, "help");
    assert.equal(slash.command, "help");
    assert.equal(natural.card, "help");
    assert.equal(natural.command, "help");
  });

  it("parses d2 bind link commands", async () => {
    const flag = commands.parseCommandLine("--bind", { senderQq: "1665240495" });
    const slash = commands.parseCommandLine("/d2bind", { senderQq: "1665240495" });
    const natural = commands.buildCommandInvocationFromText(event, "绑定命运2");

    for (const invocation of [flag, slash, natural]) {
      assert.equal(invocation.card, "bind");
      assert.equal(invocation.command, "bind");
      assert.deepEqual(invocation.params, { qq: "1665240495" });
    }

    const envelope = await executeD2CommandEnvelope(
      { commandLine: "--bind", senderQq: "1665240495" },
      { baseUrl: "http://d2.local" },
      {
        fetchImpl: async (url, init) => {
          assert.equal(String(url), "http://d2.local/api/d2/bindings/qq/oauth/start");
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { qq: "1665240495" });
          return new Response(JSON.stringify({
            success: true,
            data: {
              bindUrl: "http://d2.local/api/d2/bind/abc123",
              message: "请在3分钟之内访问该链接进行绑定\nhttp://d2.local/api/d2/bind/abc123",
            },
          }), { status: 200, headers: { "content-type": "application/json" } });
        },
      },
    );

    assert.equal(envelope.success, true);
    assert.equal(envelope.type, "bind_link");
    assert.equal(envelope.command, "bind");
    assert.match(envelope.message, /api\/d2\/bind\/abc123/u);
  });

  it("returns a normalized command envelope for help", async () => {
    const envelope = await executeD2CommandEnvelope({ commandLine: "--help", senderQq: "1665240495" });

    assert.equal(envelope.success, true);
    assert.equal(envelope.type, "text");
    assert.equal(envelope.command, "help");
    assert.match(envelope.message, /D2 命令网关/u);
  });

  it("parses command-gateway stat commands with sender QQ defaults", () => {
    const invocation = commands.parseCommandLine("--raid", { senderQq: "1665240495" });

    assert.equal(invocation.card, "raid_overview");
    assert.equal(invocation.target, "1665240495");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      card: "raid_overview",
      mode: "raid",
      historyPages: 2,
      pgcrLimit: 30,
    });
  });

  it("parses command-gateway structured inventory flags", () => {
    const invocation = commands.parseCommandLine("--search --weapon-type 手炮 --rpm 120 --bucket vault", { senderQq: "1665240495" });

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

  it("parses command-gateway public item info commands without a target", () => {
    const invocation = commands.parseCommandLine("--item 极高反射", { senderQq: "1665240495" });

    assert.equal(invocation.card, "item_info");
    assert.equal(invocation.target, "");
    assert.deepEqual(invocation.params, {
      card: "item_info",
      q: "极高反射",
      limit: 6,
    });
  });

  it("parses command-gateway public Perk weapon commands without a target", () => {
    const invocation = commands.parseCommandLine("--perk 爆破专家 --perk 斩首武器 --weapon-type 冲锋枪", { senderQq: "1665240495" });

    assert.equal(invocation.card, "perk_weapons");
    assert.equal(invocation.target, "");
    assert.deepEqual(invocation.params, {
      card: "perk_weapons",
      perks: ["斩首武器", "爆破专家"],
      weaponType: "冲锋枪",
      limit: 50,
    });
  });

  it("does not treat d2stats perk command flags as perk names", () => {
    const invocation = commands.parseCommandLine("/d2stats --perk-weapons 超冲能弹夹", { senderQq: "1665240495" });

    assert.equal(invocation.card, "perk_weapons");
    assert.equal(invocation.target, "");
    assert.deepEqual(invocation.params, {
      card: "perk_weapons",
      perks: ["超冲能弹夹"],
      limit: 50,
    });
  });

  it("routes natural Perk roll-pool questions to public Perk weapon cards", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查爆破专家斩首武器的冲锋枪");

    assert.equal(invocation.card, "perk_weapons");
    assert.equal(invocation.target, "");
    assert.deepEqual(invocation.params, {
      card: "perk_weapons",
      perks: ["爆破专家", "斩首武器"],
      weaponType: "冲锋枪",
      limit: 50,
    });
  });

  it("keeps personal perk wording on OAuth inventory search", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查我的爆破专家武器");

    assert.equal(invocation.card, "inventory");
    assert.equal(invocation.target, "1665240495");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      q: "爆破专家武器",
      view: "search",
      bucket: "all",
    });
  });

  it("routes natural weapon detail questions to public item info cards", () => {
    for (const text of ["查个武器，极高反射", "查极高反射perk", "极高反射怎么获取"]) {
      const invocation = bridge.buildD2DirectInvocation(event, text);

      assert.equal(invocation.card, "item_info", text);
      assert.equal(invocation.target, "");
      assert.equal(invocation.params.card, "item_info");
      assert.equal(invocation.params.q, "极高反射");
    }
  });

  it("routes personal item wording to OAuth inventory search", () => {
    for (const text of ["查我的极高反射", "仓库里的极高反射"]) {
      const invocation = bridge.buildD2DirectInvocation(event, text);

      assert.equal(invocation.card, "inventory", text);
      assert.equal(invocation.target, "1665240495");
      assert.deepEqual(invocation.params, {
        target: "1665240495",
        q: "极高反射",
        view: "search",
        bucket: text.includes("仓库") ? "vault" : "all",
      });
    }
  });

  it("uses an item-info-specific error when detail cards return no image", () => {
    assert.equal(
      bridge.d2DirectFallbackMessage("item_info", undefined, "工具返回了普通文本"),
      "没有生成武器详情图片：工具返回了普通文本",
    );
  });

  it("uses a Perk-lookup-specific error when roll-pool cards return no image", () => {
    assert.equal(
      bridge.d2DirectFallbackMessage("perk_weapons", undefined, "工具返回了普通文本"),
      "没有生成 Perk 反查图片：工具返回了普通文本",
    );
  });

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

  it("routes bulk inventory write wording to item action instead of search", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "把我命运2的防具全部转移到仓库");

    assert.equal(invocation.card, "item_action");
    assert.equal(invocation.target, "1665240495");
    assert.equal(invocation.params.action, "transfer_items");
    assert.equal(invocation.params.mode, "execute");
    assert.deepEqual(invocation.params.destination, { owner: "vault" });
    assert.equal(invocation.params.filters.itemKind, "armor");
    assert.equal(invocation.params.filters.includeEquipped, false);
  });

  it("parses batch move commands with character source and vault destination", () => {
    const invocation = commands.parseCommandLine("--move --from warlock --to vault --kind weapon", { senderQq: "1665240495" });

    assert.equal(invocation.command, "move");
    assert.equal(invocation.card, "item_action");
    assert.equal(invocation.params.action, "transfer_items");
    assert.deepEqual(invocation.params.source, { owner: "character", className: "warlock" });
    assert.deepEqual(invocation.params.destination, { owner: "vault" });
    assert.equal(invocation.params.filters.itemKind, "weapon");
  });

  it("parses natural character backpack move requests", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "把术士背包武器放仓库");

    assert.equal(invocation.card, "item_action");
    assert.equal(invocation.params.action, "transfer_items");
    assert.deepEqual(invocation.params.source, { owner: "character", className: "warlock" });
    assert.deepEqual(invocation.params.destination, { owner: "vault" });
    assert.equal(invocation.params.filters.itemKind, "weapon");
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

  it("routes loadout list queries to loadout management", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "读取我的配装");

    assert.equal(invocation.card, "loadout_manage");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      operation: "list",
    });
  });

  it("routes expanded loadout read aliases to image loadout management", () => {
    for (const text of ["查看我的游戏内配装", "本地配装列表", "保存的配装"]) {
      const invocation = bridge.buildD2DirectInvocation(event, text);

      assert.equal(invocation.card, "loadout_manage", text);
      assert.deepEqual(invocation.params, {
        target: "1665240495",
        operation: "list",
      });
    }
  });

  it("uses a loadout-specific error when read operations return no image", () => {
    assert.equal(
      bridge.d2DirectFallbackMessage("loadout_manage", "list", "工具返回了普通文本"),
      "没有生成配装图片：工具返回了普通文本",
    );
    assert.equal(
      bridge.d2DirectFallbackMessage("loadout_manage", "list", "https://www.luciferfore.com/api/d2/share/abc"),
      "https://www.luciferfore.com/api/d2/share/abc",
    );
  });

  it("routes weapon catalyst status queries to personal catalyst cards", () => {
    for (const text of ["查下挽歌的催化", "查询下虫狙的催化", "我的挽歌催化进度"]) {
      const invocation = bridge.buildD2DirectInvocation(event, text);

      assert.equal(invocation.card, "catalyst_status", text);
      assert.equal(invocation.target, "1665240495");
      assert.equal(invocation.params.target, "1665240495");
      assert.equal(invocation.params.card, "catalyst_status");
      assert.match(invocation.params.q, /挽歌|虫狙/u);
    }
  });

  it("routes explicit catalyst effect wording to public catalyst info cards", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "我需要查询挽歌的催化效果是什么");

    assert.equal(invocation.card, "catalyst_info");
    assert.deepEqual(invocation.params, {
      card: "catalyst_info",
      q: "挽歌",
    });
  });

  it("keeps bare catalyst commands on QQ OAuth catalyst progress", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "查我的催化");

    assert.equal(invocation.card, "catalysts");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      card: "catalysts",
      mode: "all",
    });
  });

  it("uses a catalyst-effect-specific error when effect cards return no image", () => {
    assert.equal(
      bridge.d2DirectFallbackMessage("catalyst_info", undefined, "工具返回了普通文本"),
      "没有生成催化效果图片：工具返回了普通文本",
    );
    assert.equal(
      bridge.d2DirectFallbackMessage("catalyst_status", undefined, "工具返回了普通文本"),
      "没有生成催化图片：工具返回了普通文本",
    );
  });

  it("routes local loadout saves to loadout management", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "保存当前装备为日落套");

    assert.equal(invocation.card, "loadout_manage");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      operation: "save_local",
      name: "日落套",
    });
  });

  it("routes in-game loadout slots with zero-based indexes", () => {
    const invocation = bridge.buildD2DirectInvocation(event, "保存到游戏内第2槽");

    assert.equal(invocation.card, "loadout_manage");
    assert.deepEqual(invocation.params, {
      target: "1665240495",
      operation: "snapshot_bungie",
      loadoutIndex: 1,
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
