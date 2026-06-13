const COMMANDS = [
  { name: "help", flags: ["--help", "-h"], aliases: ["/help", "/d2help", "/d2帮助", "/命运2帮助", "d2help", "d2帮助", "d2菜单", "命运2帮助", "命运2菜单", "帮助", "菜单"], output: "text", description: "输出所有命运2命令。" },
  { name: "summary", flags: ["--summary"], aliases: ["/战绩", "战绩", "总览"], card: "summary", output: "image", description: "账号总览战绩图。" },
  { name: "career", flags: ["--career"], aliases: ["/生涯", "生涯"], card: "career", output: "image", description: "生涯总览长图。" },
  { name: "profile", flags: ["--profile"], aliases: ["/资料", "资料", "角色"], card: "profile", output: "image", description: "角色、光等、在线时间。" },
  { name: "namecard", flags: ["--namecard"], aliases: ["/名片", "名片"], card: "namecard", output: "image", description: "玩家名片资料。" },
  { name: "pvp", flags: ["--pvp"], aliases: ["/pvp", "pvp", "熔炉", "试炼"], card: "pvp", output: "image", description: "PVP / 试炼战绩图。" },
  { name: "raid", flags: ["--raid"], aliases: ["/raid", "raid", "突袭"], card: "raid_overview", output: "image", description: "突袭总览、次数、最快、无暇、Day One。" },
  { name: "dungeon", flags: ["--dungeon"], aliases: ["/地牢", "地牢", "dungeon"], card: "dungeon_overview", output: "image", description: "地牢总览、Solo/无暇、最快。" },
  { name: "gm", flags: ["--gm", "--grandmasters"], aliases: ["/宗师", "/gm", "宗师", "日落", "夜幕", "gm"], card: "grandmasters", output: "image", description: "宗师夜幕总览与最近队伍。" },
  { name: "heatmap", flags: ["--heatmap"], aliases: ["/热力图", "热力图", "活跃"], card: "heatmap", output: "image", description: "活跃热力图。" },
  { name: "weapons", flags: ["--weapons"], aliases: ["/武器", "武器"], card: "weapons", output: "image", description: "武器使用统计。" },
  { name: "item", flags: ["--item", "--weapon-info"], aliases: ["/武器查询", "武器查询", "查武器", "武器资料"], card: "item_info", output: "image", description: "公开 Manifest 武器/物品详情。" },
  { name: "perk-weapons", flags: ["--perk-weapons", "--perk"], aliases: ["/perk查询", "perk查询", "查询perk", "特性查询"], card: "perk_weapons", output: "image", description: "公开 Perk -> 可滚武器反查。" },
  { name: "crafting", flags: ["--crafting", "--craftables"], aliases: ["/锻造", "锻造", "图纸"], card: "crafting", output: "image", description: "可锻造武器/图纸状态。" },
  { name: "activities", flags: ["--activities"], aliases: ["/活动", "活动", "最近活动"], card: "activities", output: "image", description: "最近活动列表。" },
  { name: "latest", flags: ["--latest"], aliases: ["/最近", "最近一把"], card: "latest_activity", output: "image", description: "最近一场活动 PGCR。" },
  { name: "activity", flags: ["--activity", "--pgcr"], aliases: ["/pgcr", "单局"], card: "activity", output: "image", description: "指定 PGCR 单局详情，需要 activityId。" },
  { name: "vault", flags: ["--vault"], aliases: ["/仓库", "仓库"], card: "inventory", output: "image", description: "OAuth 仓库长图。" },
  { name: "equipped", flags: ["--equipped"], aliases: ["/装备", "当前装备", "身上装备", "现有装备"], card: "inventory", output: "image", description: "OAuth 当前装备图。" },
  { name: "inventory", flags: ["--inventory"], aliases: ["/背包", "背包", "库存"], card: "inventory", output: "image", description: "OAuth 背包/库存图。" },
  { name: "search", flags: ["--search"], aliases: ["/仓库搜索", "仓库搜索", "搜索"], card: "inventory", output: "image", description: "OAuth 物品搜索，支持 weaponType/rpm/perk 等结构化条件。" },
  { name: "move", flags: ["--move"], aliases: ["/移动", "/转移", "移动物品", "转移物品"], card: "item_action", output: "text", description: "OAuth 批量移动物品，支持 --to vault、--kind armor、--weapon-type 手炮。" },
  { name: "bind", flags: ["--bind", "--login"], aliases: ["/d2bind", "/d2绑定", "/绑定命运2", "d2bind", "d2绑定", "绑定命运2", "命运2绑定", "登录命运2", "命运2登录", "棒鸡绑定", "绑定棒鸡"], card: "bind", output: "bind_link", description: "生成 QQ -> Bungie OAuth 绑定链接。" },
  { name: "catalysts", flags: ["--catalysts"], aliases: ["/催化", "我的催化", "催化进度"], card: "catalysts", output: "image", description: "OAuth 全量催化进度。" },
  { name: "catalyst", flags: ["--catalyst"], aliases: ["单武器催化"], card: "catalyst_status", output: "image", description: "OAuth 单把金枪催化状态 + 效果。" },
  { name: "catalyst-info", flags: ["--catalyst-info"], aliases: ["催化效果"], card: "catalyst_info", output: "image", description: "公开金枪催化效果说明。" },
  { name: "loadouts", flags: ["--loadouts"], aliases: ["/套装列表", "读取配装", "查看配装"], card: "loadout_manage", output: "image", description: "OAuth 读取游戏内 Loadout + 本地配装库。" },
  { name: "optimize", flags: ["--optimize"], aliases: ["/配装", "三百套", "配装"], card: "loadout_optimizer", output: "image", description: "OAuth Armor 3.0 配装搜索。" },
];

const MODE_WORDS = [
  ["trials", ["trials", "试炼"]],
  ["pvp", ["pvp", "熔炉", "crucible"]],
  ["gambit", ["gambit", "智谋"]],
  ["raid", ["raid", "突袭"]],
  ["dungeon", ["dungeon", "地牢"]],
];

const WEAPON_TYPE_ALIASES = [
  { canonical: "冲锋枪", terms: ["冲锋枪", "微冲", "微冲枪", "微型冲锋枪", "smg", "submachine gun", "submachinegun", "submachine"] },
  { canonical: "手炮", terms: ["手炮", "hc", "hand cannon", "handcannon"] },
  { canonical: "霰弹枪", terms: ["霰弹枪", "霰弹", "喷子", "shotgun"] },
  { canonical: "自动步枪", terms: ["自动步枪", "自动", "ar", "auto rifle", "autorifle"] },
  { canonical: "脉冲步枪", terms: ["脉冲步枪", "脉冲", "pulse rifle", "pulserifle", "pulse"] },
  { canonical: "斥候步枪", terms: ["斥候步枪", "斥候", "scout rifle", "scoutrifle", "scout"] },
  { canonical: "狙击步枪", terms: ["狙击步枪", "狙击枪", "狙击", "狙", "sniper rifle", "sniperrifle", "sniper"] },
  { canonical: "融合步枪", terms: ["融合步枪", "融合枪", "融合", "fusion rifle", "fusionrifle", "fusion"] },
  { canonical: "线性融合步枪", terms: ["线性融合步枪", "线性融合", "线融", "linear fusion rifle", "linear fusion", "linearfusion", "linear"] },
  { canonical: "榴弹发射器", terms: ["榴弹发射器", "榴弹", "gl", "grenade launcher", "grenadelauncher"] },
  { canonical: "火箭发射器", terms: ["火箭发射器", "火箭筒", "火箭", "筒子", "rocket launcher", "rocketlauncher", "rocket"] },
  { canonical: "机枪", terms: ["机枪", "mg", "machine gun", "machinegun"] },
  { canonical: "剑", terms: ["剑", "刀剑", "sword"] },
  { canonical: "弓", terms: ["弓", "bow"] },
  { canonical: "手枪", terms: ["手枪", "sidearm"] },
];

const LOADOUT_STATS = [
  ["mobility", ["武器", "百武", "weapon", "weapons", "机动", "敏捷", "百敏", "mobility"]],
  ["resilience", ["生命值", "生命", "百命", "health", "hp", "韧性", "韌性", "韧", "百韧", "resilience"]],
  ["recovery", ["职业", "職業", "职业技能", "百职", "class", "恢复", "恢復", "回复", "百恢", "recovery"]],
  ["discipline", ["手雷", "百雷", "grenade", "grenades", "纪律", "紀律", "百纪", "discipline"]],
  ["intellect", ["超能", "大招", "百超", "super", "智慧", "智力", "百智", "intellect"]],
  ["strength", ["近战", "近戰", "百近", "melee", "力量", "百力", "strength"]],
];

const D2_WORDS = [
  "命运2", "destiny 2", "destiny2", "d2", "bungie", "棒鸡", "战绩", "地牢", "突袭", "raid", "配装", "三百", "三百套",
  "loadout", "build", "宗师", "日落", "夜幕", "gm", "热力图", "活跃", "锻造", "图纸", "催化", "仓库", "库存", "背包",
  "装备", "equipped", "武器", "名片", "生涯", "pvp", "熔炉", "试炼", "最近", "活动", "单局", "pgcr", "绑定", "登录", "授权", "bind", "login",
  "perk", "perks", "特性", "词条", "能出", "可出", "来源", "出处", "怎么获取", "哪里出", "怎么得", "如何获得", "是什么武器",
  "转移", "移到", "移动", "锁定", "解锁", "换上",
];

const INVENTORY_SEARCH_WORDS = WEAPON_TYPE_ALIASES.flatMap((entry) => entry.terms);
const INVENTORY_SEARCH_KEYWORDS = ["我的", "我", "查询", "查一下", "查下", "查", "看看", "看", "有哪些", "有没有", "找", "搜", "搜索"];
const KNOWN_PERK_SEARCH_TERMS = [
  "爆破专家",
  "斩首武器",
  "辉耀炽热",
  "萤火虫",
  "蜻蜓",
  "狂乱",
  "重建",
  "重组",
  "维持生计",
  "快速命中",
  "滑射",
  "首发射击",
  "精准连击",
  "不法之徒",
  "杀戮弹匣",
  "多杀弹匣",
  "肾上腺素成瘾",
  "泉源",
  "渗透",
  "诱导推销",
  "嫉妒刺客",
  "切勿靠近",
  "禅意时刻",
  "测距仪",
  "风暴之眼",
  "移动目标",
  "自动装填枪套",
  "丰盈满溢",
  "金中藏弹",
  "冰冷弹匣",
  "伏特子弹",
  "失衡弹药",
  "动能震颤"
];
const REPLAY_WORDS = ["发出来", "发出来啊", "没发图", "没图", "图呢", "图片呢", "再发一次", "重发", "再来一次", "再来张", "重新发"];

function commandHelpText() {
  return [
    "D2 命令网关",
    "QQ 帮助：/d2help 或 /d2帮助（/help 是 OpenClaw 内置帮助）",
    "",
    "基础：",
    "  d2stats --help",
    "  d2stats --raid [QQ|BungieName#1234|membershipType:membershipId]",
    "  d2stats --pvp [target]",
    "  d2stats --dungeon [target]",
    "  d2stats --gm [target]",
    "  d2stats --career | --summary | --profile | --namecard | --heatmap",
    "",
    "库存 / 装备（需要 QQ OAuth）：",
    "  d2stats --bind [QQ]",
    "  d2stats --vault",
    "  d2stats --equipped",
    "  d2stats --inventory",
    "  d2stats --search 冲锋枪 --bucket vault",
    "  d2stats --search --weapon-type 手炮 --rpm 120 --bucket vault",
    "  d2stats --move --to vault --kind armor",
    "  d2stats --move --from warlock --to vault --kind weapon",
    "  d2stats --move --from vault --to hunter --weapon-type 手炮",
    "",
    "催化 / 锻造 / 配装：",
    "  d2stats --item 极高反射",
    "  d2stats --perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪",
    "  d2stats --catalysts",
    "  d2stats --catalyst 虫狙",
    "  d2stats --catalyst-info 挽歌",
    "  d2stats --crafting",
    "  d2stats --loadouts",
    "  d2stats --optimize --class warlock --stat 生命值=100 --stat 手雷=100 --stat 武器=100",
    "",
    "规则：不写 target 时默认使用 senderQq；读取类必须返回图片或网页；未绑定会返回 3 分钟绑定链接。",
  ].join("\n");
}

function commandHelpJson() {
  return COMMANDS.map((command) => ({ ...command }));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\[CQ:at,[^\]]*\]/gu, " ")
    .replace(/\[@[^\]]*\]/gu, " ")
    .replace(/@\S+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenizeCommandLine(input) {
  const result = [];
  const text = String(input || "");
  let current = "";
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function hasAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(String(word).toLowerCase()));
}

function commandByFlag(flag) {
  const value = String(flag || "").toLowerCase();
  return COMMANDS.find((command) => command.flags.some((item) => item.toLowerCase() === value));
}

function commandByToken(token) {
  const value = String(token || "").replace(/^\/+/u, "").toLowerCase();
  return COMMANDS.find((command) =>
    command.flags.some((item) => item.replace(/^--?/u, "").toLowerCase() === value) ||
    command.name.toLowerCase() === value ||
    command.aliases.some((item) => String(item).replace(/^\/+/u, "").toLowerCase() === value)
  );
}

function parseCommandLine(commandLine, context = {}) {
  const tokens = tokenizeCommandLine(commandLine);
  const flags = new Map();
  const positional = [];
  const stats = {};
  let command = null;
  let json = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "d2" || token === "d2stats") continue;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--stat") {
      const next = tokens[index + 1] || "";
      index += next ? 1 : 0;
      applyStatArg(stats, next);
      continue;
    }
    if (token.startsWith("--")) {
      const maybeCommand = commandByFlag(token);
      if (maybeCommand && (!command || token !== "--perk")) {
        command = maybeCommand;
        continue;
      }
      const key = token.slice(2);
      const next = tokens[index + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        index += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (!command) {
      const maybeCommand = commandByToken(token);
      if (maybeCommand) {
        command = maybeCommand;
        continue;
      }
    }
    positional.push(token);
  }

  if (!command && tokens.length > 0) {
    return buildCommandInvocationFromText({ user_id: context.senderQq || context.userId }, commandLine);
  }
  if (!command) return null;
  if (command.name === "help") {
    return { command: "help", card: "help", target: "", params: { card: "help" }, json };
  }

  const target = resolveTargetFromArgs(positional, flags, context, command);
  if (!isPublicNoTargetCard(command.card) && !target) return null;
  return buildInvocationForCommand(command, {
    target,
    positional,
    flags,
    stats,
    context,
    commandLine,
  });
}

function buildInvocationForCommand(command, parsed) {
  const { target, positional, flags, stats, commandLine } = parsed;
  const card = command.card;
  if (card === "bind") {
    return { command: command.name, card, target, params: { qq: target } };
  }
  if (card === "inventory") {
    const view = inventoryViewForCommand(command.name, flags, commandLine);
    const weaponType = normalizeWeaponType(flags.get("weapon-type") || flags.get("weaponType") || weaponTypeFromText(commandLine));
    const rpm = rpmValue(flags.get("rpm")) || rpmFromText(commandLine, Boolean(weaponType));
    const q = searchQueryFromArgs(command.name, positional, flags, commandLine, weaponType, rpm);
    return {
      command: command.name,
      card,
      target,
      params: {
        target,
        q,
        ...(weaponType ? { weaponType } : {}),
        ...(rpm ? { rpm } : {}),
        ...(flags.get("slot") ? { slot: String(flags.get("slot")) } : {}),
        ...(flags.get("damage-type") || flags.get("damageType") ? { damageType: String(flags.get("damage-type") || flags.get("damageType")) } : {}),
        ...(flags.get("perk") ? { perk: String(flags.get("perk")) } : {}),
        view,
        bucket: inventoryBucketForCommand(command.name, flags, view),
      },
    };
  }
  if (card === "item_action") {
    return { command: command.name, card, target, params: moveParamsFromCommand(commandLine, positional, flags, target) };
  }
  if (card === "catalyst_status") {
    const q = cleanCatalystQuery(positional.join(" ") || flags.get("q") || flags.get("weapon") || commandLine);
    return { command: command.name, card, target, params: { target, card, q } };
  }
  if (card === "catalyst_info") {
    const q = cleanCatalystQuery(positional.join(" ") || flags.get("q") || flags.get("weapon") || commandLine);
    return { command: command.name, card, target: "", params: { card, q } };
  }
  if (card === "item_info") {
    const q = cleanItemInfoQuery(positional.join(" ") || flags.get("q") || flags.get("item") || flags.get("weapon") || commandLine);
    return q ? { command: command.name, card, target: "", params: { card, q, limit: integerValue(flags.get("limit"), 6) } } : null;
  }
  if (card === "perk_weapons") {
    const perkParams = perkWeaponParamsFromText(commandLine, positional, flags);
    return perkParams.perks.length ? { command: command.name, card, target: "", params: { card, ...perkParams } } : null;
  }
  if (card === "loadout_manage") {
    return { command: command.name, card, target, params: { target, operation: "list" } };
  }
  if (card === "loadout_optimizer") {
    return {
      command: command.name,
      card,
      target,
      params: {
        target,
        className: classNameFromText(flags.get("class") || commandLine),
        targetStats: Object.keys(stats).length ? stats : loadoutTargetStats(commandLine),
        includeCurrentSubclassFragments: true,
        simulateStatMods: true,
        limit: integerValue(flags.get("limit"), 3),
      },
    };
  }
  if (card === "activity") {
    const activityId = flags.get("activity-id") || flags.get("activityId") || positional.find((item) => /^[0-9]{8,20}$/u.test(item)) || target;
    return { command: command.name, card, target: activityId, params: { card, activityId } };
  }
  const params = { target, card, mode: directMode(commandLine) };
  if (card === "heatmap") {
    params.range = flags.get("range") || (hasAny(commandLine, ["最近", "recent"]) ? "recent" : "year");
    if (params.range === "year") params.year = integerValue(flags.get("year"), new Date().getFullYear());
    if (params.range === "recent") params.pages = integerValue(flags.get("pages"), 2);
  }
  if (card === "raid_overview") {
    params.historyPages = integerValue(flags.get("history-pages") || flags.get("historyPages"), hasAny(commandLine, ["深", "完整", "详细"]) ? 5 : 2);
    params.pgcrLimit = integerValue(flags.get("pgcr-limit") || flags.get("pgcrLimit"), hasAny(commandLine, ["深", "完整", "详细"]) ? 100 : 30);
  }
  if (card === "dungeon_overview") {
    params.historyPages = integerValue(flags.get("history-pages") || flags.get("historyPages"), 5);
    params.pgcrLimit = integerValue(flags.get("pgcr-limit") || flags.get("pgcrLimit"), hasAny(commandLine, ["深", "完整", "详细"]) ? 100 : 50);
  }
  if (card === "grandmasters") {
    params.historyPages = integerValue(flags.get("history-pages") || flags.get("historyPages"), 5);
    params.pgcrLimit = integerValue(flags.get("pgcr-limit") || flags.get("pgcrLimit"), 30);
    params.season = flags.get("season") || "all";
  }
  return { command: command.name, card, target, params };
}

function isPublicNoTargetCard(card) {
  return card === "catalyst_info" || card === "item_info" || card === "perk_weapons";
}

function resolveTargetFromArgs(positional, flags, context, command) {
  const explicit = flags.get("target") || flags.get("qq") || flags.get("sender-qq") || flags.get("senderQq");
  if (explicit) return String(explicit);
  if (isPublicNoTargetCard(command.card)) return "";
  if (command.card === "bind") {
    const qq = positional.find((item) => /^[0-9]{5,15}$/u.test(String(item || "")));
    if (qq) return qq;
    return String(context.senderQq || context.userId || context.user_id || context.qq || "").trim();
  }
  const target = positional.find((item) => isTargetLike(item));
  if (target) return target;
  return String(context.senderQq || context.userId || context.user_id || context.qq || "").trim();
}

function isTargetLike(value) {
  const text = String(value || "");
  return /^[0-9]{5,30}$/u.test(text) || /^[0-9]{1,3}[:/\s]+[0-9]{8,30}$/u.test(text) || /^.+#[0-9]{1,4}$/u.test(text);
}

function buildCommandInvocationFromText(event = {}, text = "") {
  const value = normalizeText(text);
  if (!value) return null;
  if (isFlagLike(value)) {
    return parseCommandLine(value, { senderQq: event.user_id || event.senderQq || event.qq });
  }
  if (hasItemActionIntent(value)) {
    const target = extractTarget(value, event, "item_action");
    return target ? { command: "item_action", card: "item_action", target, params: itemActionParamsFromText(value, target) } : null;
  }
  const directPerkWeapons = directKnownPerkWeaponsInvocation(value);
  if (directPerkWeapons) return directPerkWeapons;
  const card = inferCard(value);
  if (!card) return null;
  const target = extractTarget(value, event, card);
  if (card !== "help" && !isPublicNoTargetCard(card) && !target) return null;
  if (card === "help") return { command: "help", card: "help", target: "", params: { card: "help" } };
  if (card === "bind") return { command: "bind", card, target, params: { qq: target } };
  if (card === "catalyst_info") {
    const q = cleanCatalystQuery(value);
    return q ? { command: "catalyst-info", card, target: "", params: { card, q } } : null;
  }
  if (card === "item_info") {
    const q = cleanItemInfoQuery(value);
    return q ? { command: "item", card, target: "", params: { card, q } } : null;
  }
  if (card === "perk_weapons") {
    const perkParams = perkWeaponParamsFromText(value);
    return perkParams.perks.length ? { command: "perk-weapons", card, target: "", params: { card, ...perkParams } } : null;
  }
  if (card === "catalyst_status") {
    const q = cleanCatalystQuery(value);
    return q ? { command: "catalyst", card, target, params: { target, card, q } } : null;
  }
  if (card === "inventory") {
    let view = inventoryView(value);
    const searchParts = inventorySearchParts(value, target);
    if (searchParts.q || searchParts.weaponType || searchParts.rpm || searchParts.slot || searchParts.damageType || searchParts.perk) view = "search";
    return { command: "inventory", card, target, params: { target, ...searchParts, view, bucket: inventoryBucket(value, view) } };
  }
  if (card === "loadout_manage") {
    return { command: "loadouts", card, target, params: loadoutManageParams(value, target) };
  }
  if (card === "loadout_optimizer") {
    return {
      command: "optimize",
      card,
      target,
      params: {
        target,
        className: classNameFromText(value),
        targetStats: loadoutTargetStats(value),
        includeCurrentSubclassFragments: true,
        simulateStatMods: true,
        limit: 3,
      },
    };
  }
  const params = card === "activity" ? { card, activityId: target } : { target, card, mode: directMode(value) };
  if (card === "heatmap") {
    params.range = hasAny(value, ["最近", "recent"]) ? "recent" : "year";
    if (params.range === "year") {
      const year = /\b(20[0-9]{2})\b/u.exec(value);
      params.year = year ? Number(year[1]) : new Date().getFullYear();
    } else {
      params.pages = 2;
    }
  }
  if (card === "raid_overview") {
    const deep = hasAny(value, ["深", "完整", "详细"]);
    params.historyPages = deep ? 5 : 2;
    params.pgcrLimit = deep ? 100 : 30;
  }
  if (card === "dungeon_overview") {
    const deep = hasAny(value, ["深", "完整", "详细"]);
    params.historyPages = 5;
    params.pgcrLimit = deep ? 100 : 50;
  }
  if (card === "grandmasters") {
    params.historyPages = 5;
    params.pgcrLimit = 30;
    params.season = "all";
  }
  return { command: commandFromCard(card), card, target, params };
}

function directKnownPerkWeaponsInvocation(value) {
  if (hasPersonalItemInfoIntent(value)) return null;
  const perks = uniquePerkTerms(KNOWN_PERK_SEARCH_TERMS.filter((perk) => value.includes(perk)));
  if (!perks.length) return null;
  const weaponType = weaponTypeFromText(value);
  if (!weaponType && !hasAny(value, ["perk查询", "查询perk", "特性查询", "能出", "可出", "可以出", "会出", "有哪些武器", "哪些武器", "什么武器", "枪械"])) return null;
  return {
    command: "perk-weapons",
    card: "perk_weapons",
    target: "",
    params: {
      card: "perk_weapons",
      perks,
      ...(weaponType ? { weaponType } : {}),
      limit: 50,
    },
  };
}

function isFlagLike(value) {
  return /(^|\s)(d2stats|d2|--[a-z-]+|\/[a-z\u4e00-\u9fff]+)/iu.test(value);
}

function inferCard(text) {
  const value = normalizeText(text);
  const itemInfoIntent = hasItemInfoIntent(value);
  const personalItemInfoIntent = hasPersonalItemInfoIntent(value);
  const perkWeaponsIntent = hasPerkWeaponsIntent(value);
  if (
    !value ||
    (!hasAny(value, D2_WORDS) &&
      !hasAny(value, INVENTORY_SEARCH_WORDS) &&
      !hasLoadoutIntent(value) &&
      !hasLoadoutManageIntent(value) &&
      !perkWeaponsIntent &&
      !itemInfoIntent &&
      !personalItemInfoIntent)
  ) return null;
  if (hasAny(value, ["帮助", "菜单", "help", "指令", "命令"])) return "help";
  if (hasAny(value, ["d2bind", "d2绑定", "绑定命运2", "命运2绑定", "登录命运2", "命运2登录", "棒鸡绑定", "绑定棒鸡", "bungie绑定", "绑定bungie", "oauth绑定", "授权绑定"])) return "bind";
  if (hasItemActionIntent(value)) return "item_action";
  if (looksLikeKnownPerkWeaponQuery(value)) return "perk_weapons";
  if (hasLoadoutManageIntent(value)) return "loadout_manage";
  if (hasLoadoutIntent(value)) return "loadout_optimizer";
  if (hasAny(value, ["催化", "catalyst"])) return inferCatalystCard(value);
  if (personalItemInfoIntent) return "inventory";
  if (perkWeaponsIntent) return "perk_weapons";
  if (hasAny(value, ["仓库搜索", "仓库", "库存", "背包", "现有装备", "身上装备", "当前装备", "我穿什么", "查装备", "装备", "inventory", "vault", "equipped"])) return "inventory";
  if (hasAny(value, INVENTORY_SEARCH_WORDS) && hasAny(value, INVENTORY_SEARCH_KEYWORDS)) return "inventory";
  if (itemInfoIntent) return "item_info";
  if (hasAny(value, ["锻造", "图纸", "craft", "pattern"])) return "crafting";
  if (hasAny(value, ["宗师", "日落", "夜幕", "grandmaster", "gm"])) return "grandmasters";
  if (hasAny(value, ["地牢", "dungeon"])) return "dungeon_overview";
  if (hasAny(value, ["突袭", "raid"])) return "raid_overview";
  if (hasAny(value, ["热力图", "活跃", "heatmap"])) return "heatmap";
  if (hasAny(value, ["生涯", "career"])) return "career";
  if (hasAny(value, ["名片", "namecard"])) return "namecard";
  if (hasAny(value, ["pvp", "熔炉", "试炼", "trials", "crucible"])) return "pvp";
  if (hasAny(value, ["武器", "weapon"])) return "weapons";
  if (hasAny(value, ["单局", "pgcr"])) return "activity";
  if (hasAny(value, ["最近一把", "最近活动", "latest"])) return "latest_activity";
  if (hasAny(value, ["活动", "战绩列表", "最近"])) return "activities";
  if (hasAny(value, ["资料", "角色", "profile"])) return "profile";
  if (hasAny(value, ["战绩", "总览", "命运2", "destiny 2", "destiny2", "d2"])) return "summary";
  return null;
}

function hasItemActionIntent(text) {
  const value = normalizeText(text);
  if (!value) return false;
  if (hasLoadoutManageIntent(value)) return false;
  const hasExplicitId = /\b[0-9]{8,30}\b/u.test(value) || hasAny(value, ["itemId", "itemInstanceId"]);
  const hasWriteVerb =
    hasAny(value, ["转移", "移到", "移动", "转到", "放到", "放进", "放仓库", "存到", "存仓库", "锁定", "解锁"]) ||
    (hasAny(value, ["换上", "装备"]) && hasExplicitId);
  if (!hasWriteVerb) return false;
  return hasAny(value, ["仓库", "背包", "角色", "防具", "护甲", "武器", "装备", "itemId", "itemInstanceId", "characterId"]);
}

function itemActionParamsFromText(text, target) {
  const value = normalizeText(text);
  const action = hasAny(value, ["锁定"]) ? "lock"
      : hasAny(value, ["解锁"]) ? "unlock"
      : hasAny(value, ["换上", "装备"]) && !hasAny(value, ["转移", "移到", "转到", "放到", "放进", "放仓库", "存到", "存仓库"]) ? "equip"
        : "transfer_items";
  const transferToVault = hasAny(value, ["仓库", "vault"]);
  const ids = [...value.matchAll(/\b([0-9]{8,30})\b/gu)].map((match) => match[1]);
  const batch = action === "transfer_items";
  return {
    target,
    action,
    ...(batch
      ? transferItemsParamsFromText(value, target, ids)
      : {
          ...(transferToVault ? { transferToVault: true } : {}),
          ...(ids[0] ? { itemId: ids[0] } : {}),
          ...(ids[1] ? { characterId: ids[1] } : {}),
        }),
  };
}

function moveParamsFromCommand(commandLine, positional, flags, target) {
  const itemIds = String(flags.get("item-ids") || flags.get("itemIds") || "")
    .split(/[,，\s]+/u)
    .filter(Boolean);
  return {
    target,
    action: "transfer_items",
    mode: String(flags.get("mode") || "execute"),
    source: transferSourceFromText(String(flags.get("from") || ""), commandLine),
    destination: transferDestinationFromText(String(flags.get("to") || ""), commandLine),
    filters: {
      itemIds,
      itemKind: transferItemKind(flags.get("kind") || flags.get("item-kind") || flags.get("itemKind") || commandLine),
      ...(flags.get("weapon-type") || flags.get("weaponType") || weaponTypeFromText(commandLine)
        ? { weaponType: normalizeWeaponType(flags.get("weapon-type") || flags.get("weaponType") || weaponTypeFromText(commandLine)) }
        : {}),
      ...(flags.get("armor-slot") || flags.get("armorSlot") || armorSlotFromText(commandLine)
        ? { armorSlot: String(flags.get("armor-slot") || flags.get("armorSlot") || armorSlotFromText(commandLine)) }
        : {}),
      ...(flags.get("bucket") ? { bucket: String(flags.get("bucket")) } : {}),
      q: flags.get("q") || positional.filter((item) => !isTargetLike(item)).join(" "),
      locked: flags.get("locked") === undefined ? null : /true|1|yes|on|锁/u.test(String(flags.get("locked"))),
      includeEquipped: hasAny(commandLine, ["包含已装备", "包含身上", "身上也", "已装备也", "穿着也"]),
    },
    maxItems: integerValue(flags.get("max") || flags.get("maxItems"), 100),
  };
}

function transferItemsParamsFromText(value, target, ids = []) {
  return {
    target,
    mode: "execute",
    source: transferSourceFromText("", value),
    destination: transferDestinationFromText("", value),
    filters: {
      itemIds: ids,
      itemKind: transferItemKind(value),
      ...(weaponTypeFromText(value) ? { weaponType: normalizeWeaponType(weaponTypeFromText(value)) } : {}),
      ...(armorSlotFromText(value) ? { armorSlot: armorSlotFromText(value) } : {}),
      q: transferResidualQuery(value),
      locked: null,
      includeEquipped: hasAny(value, ["包含已装备", "包含身上", "身上也", "已装备也", "穿着也"]),
    },
    maxItems: 100,
  };
}

function transferSourceFromText(flagValue, fullText) {
  const flag = normalizeText(flagValue);
  const text = normalizeText(fullText);
  const sourceText = flag || text;
  if (hasAny(sourceText, ["vault", "仓库"])) {
    if (flag || hasAny(text, ["从仓库", "仓库里", "仓库里的"])) return { owner: "vault" };
  }
  if (hasAny(sourceText, ["equipped", "已装备", "身上", "穿着"])) return { owner: "equipped" };
  if (hasAny(sourceText, ["inventory", "背包"])) {
    const className = classNameFromText(sourceText);
    return className ? { owner: "character", className } : { owner: "inventory" };
  }
  const className = classNameFromText(flag || sourceClassPhrase(text));
  if (className) return { owner: "character", className };
  return { owner: "all" };
}

function transferDestinationFromText(flagValue, fullText) {
  const flag = normalizeText(flagValue);
  const text = normalizeText(fullText);
  const destinationText = flag || text;
  if (!flag && hasAny(text, ["仓库", "vault"])) return { owner: "vault" };
  if (hasAny(destinationText, ["vault", "仓库"])) return { owner: "vault" };
  const className = classNameFromText(flag || destinationClassPhrase(text));
  if (className) return { owner: "character", className };
  return { owner: "vault" };
}

function sourceClassPhrase(text) {
  const match = /(术士|猎人|泰坦|warlock|hunter|titan)\s*(?:背包|身上|已装备|装备|的)/iu.exec(text);
  return match?.[1] || "";
}

function destinationClassPhrase(text) {
  const match = /(?:给|到|移到|转到|放到|放进)\s*(术士|猎人|泰坦|warlock|hunter|titan)/iu.exec(text);
  return match?.[1] || "";
}

function transferItemKind(value) {
  const text = normalizeText(value);
  if (hasAny(text, ["防具", "护甲", "armor"])) return "armor";
  if (hasAny(text, ["武器", "weapon"])) return "weapon";
  return "all";
}

function armorSlotFromText(value) {
  const text = normalizeText(value);
  if (/头|头盔|helmet/u.test(text)) return "头盔";
  if (/手|臂|臂铠|手套|gauntlet/u.test(text)) return "臂铠";
  if (/胸|胸甲|chest/u.test(text)) return "胸甲";
  if (/腿|腿甲|leg/u.test(text)) return "腿甲";
  if (/职业物品|职业|class item/u.test(text)) return "职业物品";
  return "";
}

function transferResidualQuery(value) {
  const weaponType = weaponTypeFromText(value);
  const armorSlot = armorSlotFromText(value);
  return normalizeText(value)
    .replace(/命运2|destiny\s*2|d2|把|将|请|帮我|我的|我|全部|所有|全都|一键|转移|移动|移到|转到|放到|放进|存到|仓库|vault|背包|inventory|身上|已装备|装备|防具|护甲|武器|包含已装备|包含身上|也/giu, " ")
    .replace(weaponType || "", " ")
    .replace(armorSlot || "", " ")
    .replace(/术士|猎人|泰坦|warlock|hunter|titan/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function looksLikeKnownPerkWeaponQuery(value) {
  if (hasPersonalItemInfoIntent(value)) return false;
  return KNOWN_PERK_SEARCH_TERMS.some((perk) => value.includes(perk)) && Boolean(weaponTypeFromText(value));
}

function hasItemInfoIntent(text) {
  const value = normalizeText(text);
  if (!cleanItemInfoQuery(value)) return false;
  return hasAny(value, ["查个武器", "武器查询", "查武器", "武器资料", "物品查询", "perk", "perks", "来源", "出处", "怎么获取", "哪里出", "怎么得", "如何获得", "是什么武器", "是什么", "好不好用", "好用吗"]);
}

function hasPerkWeaponsIntent(text) {
  const value = normalizeText(text);
  if (!value || hasPersonalItemInfoIntent(value)) return false;
  const params = perkWeaponParamsFromText(value);
  if (!params.perks.length) return false;
  if (params.weaponType || params.rpm || params.craftable !== undefined) return true;
  return hasAny(value, ["perk查询", "查询perk", "特性查询", "能出", "可出", "可以出", "会出", "带", "有哪些武器", "哪些武器", "什么武器", "枪械", "特性", "词条"]);
}

function perkWeaponParamsFromText(text, positional = [], flags = new Map()) {
  const rawText = normalizeText(text);
  const flagPerks = perkTermsFromFlags(rawText, flags);
  const positionalText = positional
    .filter((item) => item && !isTargetLike(item) && !String(item).startsWith("--"))
    .join(" ");
  const naturalSource = positionalText || (flags.size ? "" : rawText);
  const natural = naturalSource ? perkTermsFromNaturalText(naturalSource) : [];
  const perks = uniquePerkTerms([...flagPerks, ...natural]);
  const weaponType = normalizeWeaponType(flags.get("weapon-type") || flags.get("weaponType") || flags.get("type") || weaponTypeFromText(rawText));
  const rpm = rpmValue(flags.get("rpm")) || rpmFromText(rawText, Boolean(weaponType)) || 0;
  const craftable = booleanFlag(flags.get("craftable")) ?? (hasAny(rawText, ["可锻造", "图纸"]) ? true : undefined);
  const slot = String(flags.get("slot") || "").trim();
  const damageType = String(flags.get("damage-type") || flags.get("damageType") || flags.get("damage") || "").trim();
  const query = cleanPerkWeaponQuery(String(flags.get("query") || flags.get("q") || "").trim());
  const limit = integerValue(flags.get("limit"), 50);
  return {
    perks,
    ...(weaponType ? { weaponType } : {}),
    ...(rpm ? { rpm } : {}),
    ...(craftable !== undefined ? { craftable } : {}),
    ...(slot ? { slot } : {}),
    ...(damageType ? { damageType } : {}),
    ...(query ? { query } : {}),
    limit,
  };
}

function perkTermsFromFlags(commandLine, flags) {
  const values = [];
  const direct = flags.get("perk-weapons") || flags.get("perks") || flags.get("perk");
  if (direct) values.push(...splitPerkTerms(direct));
  for (const match of String(commandLine || "").matchAll(/--perk(?:-weapons)?(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s-][^\s]*))/giu)) {
    values.push(...splitPerkTerms(match[1] || match[2] || match[3] || ""));
  }
  return values;
}

function perkTermsFromNaturalText(text, positional = []) {
  const known = [];
  let working = normalizeText(`${positional.join(" ")} ${text}`);
  for (const term of [...KNOWN_PERK_SEARCH_TERMS].sort((a, b) => b.length - a.length)) {
    if (working.includes(term)) {
      known.push(term);
      working = working.replace(new RegExp(escapeRegExp(term), "gu"), " ");
    }
  }
  if (known.length) return known;
  const cleaned = cleanPerkWeaponQuery(working);
  return splitPerkTerms(cleaned).filter((term) => term.length >= 2);
}

function splitPerkTerms(value) {
  return String(value || "")
    .split(/[,，、+＋&＆/|]|(?:\s+(?:和|与|以及)\s*)/gu)
    .map(cleanPerkWeaponQuery)
    .filter(Boolean);
}

function cleanPerkWeaponQuery(value) {
  let cleaned = normalizeText(value)
    .replace(/^\/+/u, "")
    .replace(/命运2|destiny\s*2|destiny2|d2stats|d2|perk查询|查询perk|特性查询|查询一下|查询下|查询|查一下|查一查|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|哪些|有哪些|什么|所有|全部|可滚|能出|可出|可以出|会出|有|带|的|枪械|枪|perk|perks|特性|词条/giu, " ")
    .replace(/[，,：:、。？?！!；;]+/gu, " ");
  const weaponType = weaponTypeFromText(cleaned);
  if (weaponType) cleaned = stripWeaponTypeTerms(cleaned, weaponType);
  cleaned = cleaned.replace(/\s+/gu, " ").trim();
  return cleaned;
}

function uniquePerkTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = String(value || "").trim();
    const key = cleaned.replace(/\s+/gu, "").toLowerCase();
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function booleanFlag(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on", "是", "可锻造"].includes(text)) return true;
  if (["false", "0", "no", "off", "否", "不可锻造"].includes(text)) return false;
  return undefined;
}

function hasPersonalItemInfoIntent(text) {
  const value = normalizeText(text);
  if (!cleanItemInfoQuery(value)) return false;
  if (hasAny(value, ["仓库", "背包", "身上", "当前装备", "已装备"])) return true;
  return hasAny(value, ["查我的", "看我的", "搜我的", "我的"]) && !hasAny(value, ["效果", "是什么", "来源", "怎么获取", "哪里出", "怎么得"]);
}

function inferCatalystCard(text) {
  const q = cleanCatalystQuery(text);
  if (/^\/?\s*催化\s*$/u.test(text) || (!q && hasAny(text, ["我的", "账号", "进度", "完成", "状态", "全量", "全部", "所有", "列表", "qq", "oauth"]))) {
    return "catalysts";
  }
  if (q && hasAny(text, ["效果", "是什么", "什么", "说明", "介绍"]) && !hasAny(text, ["我的", "进度", "完成", "获得", "有没有", "有没", "状态"])) {
    return "catalyst_info";
  }
  return q ? "catalyst_status" : "catalysts";
}

function extractTarget(text, event, card) {
  if (card === "help" || isPublicNoTargetCard(card)) return "";
  if (card === "activity") {
    const activity = /(?:activityId|pgcr)?\D*([0-9]{8,20})/iu.exec(text);
    return activity ? activity[1] : "";
  }
  const membership = /\b([0-9]{1,3})[:/\s]+([0-9]{8,30})\b/u.exec(text);
  if (membership) return `${membership[1]}:${membership[2]}`;
  const bungieName = /([^\s?,?;]+#[0-9]{1,4})/u.exec(text);
  if (bungieName) return bungieName[1];
  const withoutBotMention = text.replace(new RegExp(String(event.self_id || "") || "^$", "gu"), " ");
  const qq = /\b([0-9]{5,15})\b/u.exec(withoutBotMention);
  if (qq) return qq[1];
  return String(event.user_id || event.senderQq || event.qq || "").trim();
}

function inventoryViewForCommand(name, flags, text) {
  if (name === "vault") return "vault";
  if (name === "equipped") return "equipped";
  if (name === "inventory") return "inventory";
  if (name === "search") return "search";
  return inventoryView(text);
}

function inventoryView(text) {
  if (hasAny(text, ["仓库搜索", "search"])) return "search";
  if (hasAny(text, ["仓库", "vault"])) return "vault";
  if (hasAny(text, ["现有装备", "身上装备", "当前装备", "我穿什么", "查装备", "装备", "equipped"])) return "equipped";
  if (hasAny(text, ["背包"])) return "inventory";
  return "overview";
}

function inventoryBucketForCommand(name, flags, view) {
  const explicit = flags.get("bucket");
  if (explicit) return normalizeBucket(explicit);
  if (name === "vault" || view === "vault") return "vault";
  if (name === "equipped" || view === "equipped") return "equipped";
  if (name === "inventory" || view === "inventory") return "inventory";
  return "all";
}

function inventoryBucket(text, view) {
  if (view === "vault") return "vault";
  if (view === "equipped") return "equipped";
  if (view === "inventory") return "inventory";
  if (view === "search" && hasAny(text, ["仓库", "vault"])) return "vault";
  if (view === "search" && hasAny(text, ["背包"])) return "inventory";
  if (view === "search" && hasAny(text, ["装备", "equipped"])) return "equipped";
  return "all";
}

function normalizeBucket(value) {
  const text = String(value || "").toLowerCase();
  if (/vault|仓库/u.test(text)) return "vault";
  if (/inventory|背包/u.test(text)) return "inventory";
  if (/equipped|装备/u.test(text)) return "equipped";
  return "all";
}

function inventorySearchParts(text, target) {
  const baseText = inventoryBaseQueryText(text, target);
  const weaponType = normalizeWeaponType(weaponTypeFromText(baseText));
  const rpm = rpmFromText(baseText, Boolean(weaponType));
  let queryText = baseText;
  if (weaponType) queryText = stripWeaponTypeTerms(queryText, weaponType);
  if (rpm) queryText = stripRpmTerms(queryText, rpm);
  return {
    q: cleanInventoryQuery(queryText),
    ...(weaponType ? { weaponType } : {}),
    ...(rpm ? { rpm } : {}),
  };
}

function inventoryBaseQueryText(text, target) {
  let value = normalizeText(text);
  const removeParts = [target, "仓库搜索", "仓库", "库存", "背包", "现有装备", "身上装备", "当前装备", "我穿什么", "查装备", "装备", "inventory", "vault", "equipped", "命运2", "帮我", "我的", "我", "查询", "查一下", "查一查", "查下", "查我", "查看", "查", "看看", "看", "搜索", "搜一下", "搜", "寻找", "找一下", "找"];
  for (const part of removeParts) {
    if (!part) continue;
    value = value.replace(new RegExp(escapeRegExp(part), "giu"), " ");
  }
  return value;
}

function cleanInventoryQuery(value) {
  let cleaned = String(value || "")
    .replace(/^[\/!?#？]+|[\/!?#？]+$/gu, " ")
    .replace(/[^\p{L}\p{N}#]+/gu, " ");
  const noiseWords = ["所有的", "全部的", "的所有", "的全部", "所有", "全部", "全都", "里的", "里面", "里", "中的", "中", "有哪些", "有没有", "有无", "一共", "请问", "请", "给我", "下", "一下", "的", "术士", "猎人", "泰坦", "warlock", "hunter", "titan"];
  for (const word of noiseWords) cleaned = cleaned.replace(new RegExp(escapeRegExp(word), "giu"), " ");
  cleaned = cleaned.replace(/\s+/gu, " ").trim();
  if (!/[0-9A-Za-z\u4e00-\u9fff]/u.test(cleaned)) return "";
  return normalizeWeaponType(cleaned) || cleaned;
}

function searchQueryFromArgs(name, positional, flags, commandLine, weaponType, rpm) {
  const explicit = flags.get("q") || flags.get("query");
  if (explicit) return cleanInventoryQuery(explicit);
  const hasStructuredFilter = Boolean(
    weaponType ||
      rpm ||
      flags.get("slot") ||
      flags.get("weapon-slot") ||
      flags.get("damage-type") ||
      flags.get("damage") ||
      flags.get("perk")
  );
  if (name !== "search") {
    const parsed = inventorySearchParts(commandLine, "").q;
    return parsed && !hasStructuredFilter ? parsed : "";
  }
  const nonTarget = positional.filter((item) => !isTargetLike(item)).join(" ");
  if (!nonTarget && hasStructuredFilter) return "";
  let queryText = nonTarget || commandLine;
  if (weaponType) queryText = stripWeaponTypeTerms(queryText, weaponType);
  if (rpm) queryText = stripRpmTerms(queryText, rpm);
  return cleanInventoryQuery(queryText);
}

function normalizeWeaponType(value) {
  const compact = String(value || "").replace(/\s+/gu, "").toLowerCase();
  if (!compact) return "";
  for (const alias of WEAPON_TYPE_ALIASES) {
    if (alias.terms.some((term) => compact === String(term).replace(/\s+/gu, "").toLowerCase())) return alias.canonical;
  }
  return value;
}

function weaponTypeFromText(text) {
  const value = normalizeText(text);
  for (const alias of WEAPON_TYPE_ALIASES) {
    if (alias.terms.some((term) => textHasTerm(value, term))) return alias.canonical;
  }
  return "";
}

function textHasTerm(text, term) {
  const value = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  return Boolean(value && normalizedTerm && (value.includes(normalizedTerm) || value.replace(/\s+/gu, "").includes(normalizedTerm.replace(/\s+/gu, ""))));
}

function rpmFromText(text, hasWeaponType) {
  const explicit = /(?:^|[^\d])([1-9][0-9]{1,3})\s*(?:rpm|r\/m|射速|每分钟发射数|每分钟发射|发\/分)/iu.exec(normalizeText(text));
  const explicitValue = rpmValue(explicit?.[1]);
  if (explicitValue) return explicitValue;
  if (!hasWeaponType) return 0;
  const numbers = [...normalizeText(text).matchAll(/(?:^|[^\d])([1-9][0-9]{1,3})(?!\d)/giu)].map((match) => rpmValue(match[1])).filter(Boolean);
  return numbers.length === 1 ? numbers[0] : 0;
}

function rpmValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2000 ? number : 0;
}

function stripWeaponTypeTerms(text, weaponType) {
  const alias = WEAPON_TYPE_ALIASES.find((entry) => entry.canonical === weaponType);
  return (alias?.terms || [weaponType]).reduce((value, term) => value.replace(new RegExp(escapeRegExp(term).replace(/\s+/gu, "\\s*"), "giu"), " "), String(text || ""));
}

function stripRpmTerms(text, rpm) {
  return String(text || "")
    .replace(new RegExp(`${rpm}\\s*(?:rpm|r\\/m|射速|每分钟发射数|每分钟发射|发\\/分)`, "giu"), " ")
    .replace(new RegExp(`${rpm}`, "gu"), " ");
}

function cleanCatalystQuery(value) {
  return normalizeText(value)
    .replace(/^\/+/u, "")
    .replace(/催化剂|催化效果|催化进度|催化|效果|查询一下|查询下|查询|查一下|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|我需要|需要|我的|我|有没有|有没|是否|是什么|什么|的|命运2|destiny\s*2|d2/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanItemInfoQuery(value) {
  return normalizeText(value)
    .replace(/^\/+/u, "")
    .replace(/命运2|destiny\s*2|destiny2|d2stats|d2|查个武器|武器查询|查武器|武器资料|物品查询|查询一下|查询下|查询|查一下|查一查|查下|查看|帮我查|帮忙查|看一下|看下|看看|查|我需要|需要|这个|一下|一个|的|perk|perks|来源|出处|怎么获取|哪里出|怎么得|如何获得|是什么武器|是什么|什么|好不好用|好用吗|评价|资料/giu, " ")
    .replace(/[，,：:、。？?！!；;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasLoadoutIntent(text) {
  const value = normalizeText(text);
  if (hasAny(value, ["配装", "三百", "三百套", "loadout", "build"])) return true;
  const mentionedStats = loadoutMentionedStats(value);
  if (mentionedStats.length >= 2 && (hasAny(value, ["套装", "凑", "能凑", "达到", "有没有", "能不能"]) || /\b100\b/u.test(value))) return true;
  if (mentionedStats.length >= 1 && hasAny(value, ["套装", "凑"])) return true;
  return false;
}

function hasLoadoutManageIntent(text) {
  return hasAny(normalizeText(text), ["套装列表", "配装列表", "读取配装", "查看配装", "查看我的配装", "查配装", "我的配装", "游戏内配装", "本地配装", "保存的配装", "保存配装", "已保存配装", "保存当前装备", "保存当前配装", "保存到游戏内", "保存到第", "保存为", "装备第", "应用", "套用", "删除配装", "删掉配装", "清空第", "清空游戏内", "loadout list", "list loadout", "save loadout", "equip loadout", "apply loadout", "delete loadout", "clear loadout"]);
}

function loadoutManageParams(text, target) {
  const operation = loadoutManageOperation(text);
  const params = { target, operation };
  const index = loadoutIndexFromText(text);
  if (index !== undefined) params.loadoutIndex = index;
  const name = operation === "list" ? "" : loadoutNameFromText(text, operation);
  if (name) {
    if (operation === "apply_local" || operation === "delete_local" || operation === "show") params.idOrName = name;
    else params.name = name;
  }
  if (hasAny(text, ["覆盖", "overwrite"])) params.overwrite = true;
  return params;
}

function loadoutManageOperation(text) {
  if (hasAny(text, ["清空", "clear"])) return "clear_bungie";
  if (hasAny(text, ["保存到游戏内", "保存到第", "snapshot"])) return "snapshot_bungie";
  if (hasAny(text, ["修改游戏内", "重命名游戏内", "rename"])) return "rename_bungie";
  if (hasAny(text, ["删除", "删掉", "delete"])) return "delete_local";
  if (hasAny(text, ["应用", "套用", "apply"])) return "apply_local";
  if (hasAny(text, ["装备第", "equip loadout"])) return "equip_bungie";
  if (hasAny(text, ["保存当前", "保存为", "save loadout"])) return "save_local";
  if (hasAny(text, ["套装列表", "配装列表", "读取配装", "游戏内配装", "本地配装", "保存的配装", "保存配装", "已保存配装"])) return "list";
  if (hasAny(text, ["显示", "查看", "show"]) && loadoutNameFromText(text, "show")) return "show";
  return "list";
}

function loadoutIndexFromText(text) {
  const match = /(?:第|槽|slot\s*)\s*([0-9一二三四五六七八九十]+)/iu.exec(text) || /([0-9一二三四五六七八九十]+)\s*(?:槽|套|slot)/iu.exec(text);
  if (!match) return undefined;
  const number = chineseNumber(match[1]);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return Math.max(0, Math.min(9, number - 1));
}

function chineseNumber(value) {
  const text = String(value || "").trim();
  if (/^[0-9]+$/u.test(text)) return Number(text);
  return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[text] || 0;
}

function loadoutNameFromText(text, operation) {
  const patterns = [/保存当前(?:装备|配装)?为\s*([^\s，。,.]+)/u, /保存为\s*([^\s，。,.]+)/u, /应用\s*([^\s，。,.]+)/u, /套用\s*([^\s，。,.]+)/u, /删除(?:配装)?\s*([^\s，。,.]+)/u, /查看\s*([^\s，。,.]+)/u, /show\s+([^\s，。,.]+)/iu];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanLoadoutName(match[1]);
  }
  if (operation === "apply_local" || operation === "delete_local") {
    return cleanLoadoutName(text.replace(/^(?:应用|套用|删除|删掉|配装|套装|我的|帮我|请|查|看)+/gu, " ").replace(/(?:配装|套装)$/gu, " "));
  }
  return "";
}

function cleanLoadoutName(value) {
  return String(value || "").replace(/[\/!?#？]+/gu, " ").replace(/^(?:我的|本地|配装|套装|第[0-9一二三四五六七八九十]+套)+/gu, " ").replace(/(?:配装|套装|确认)$/gu, " ").trim();
}

function loadoutMentionedStats(text) {
  return LOADOUT_STATS.filter(([, aliases]) => hasAny(text, aliases)).map(([key]) => key);
}

function loadoutTargetStats(text) {
  const result = {};
  for (const [key, aliases] of LOADOUT_STATS) {
    if (hasAny(text, aliases)) result[key] = loadoutTargetValue(text, aliases);
  }
  return result;
}

function loadoutTargetValue(text, aliases) {
  for (const alias of aliases) {
    const escaped = escapeRegExp(alias);
    const patterns = [new RegExp(`${escaped}\\s*(?:\\+|到|达|达到|要|需要|=|：|:)?\\s*([0-9]{1,3})`, "iu"), new RegExp(`([0-9]{1,3})\\s*(?:\\+)?\\s*${escaped}`, "iu")];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const number = Number(match[1]);
      if (Number.isFinite(number)) return Math.max(0, Math.min(200, Math.trunc(number)));
    }
  }
  return 100;
}

function applyStatArg(stats, value) {
  const match = /^([^=：:]+)[=：:]([0-9]{1,3})$/u.exec(String(value || "").trim());
  if (!match) return;
  const key = statKey(match[1]);
  if (key) stats[key] = Math.max(0, Math.min(200, Number(match[2])));
}

function statKey(value) {
  const text = String(value || "").trim();
  const found = LOADOUT_STATS.find(([, aliases]) => aliases.some((alias) => alias.toLowerCase() === text.toLowerCase()));
  return found?.[0] || "";
}

function classNameFromText(text) {
  if (hasAny(text, ["术士", "warlock"])) return "warlock";
  if (hasAny(text, ["猎人", "hunter"])) return "hunter";
  if (hasAny(text, ["泰坦", "titan"])) return "titan";
  return "";
}

function directMode(text) {
  for (const [mode, words] of MODE_WORDS) {
    if (hasAny(text, words)) return mode;
  }
  return "all";
}

function commandFromCard(card) {
  const found = COMMANDS.find((command) => command.card === card);
  return found?.name || card || "";
}

function integerValue(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReplayRequest(text) {
  return hasAny(normalizeText(text), REPLAY_WORDS);
}

module.exports = {
  COMMANDS,
  commandHelpJson,
  commandHelpText,
  parseCommandLine,
  buildCommandInvocationFromText,
  inferCard,
  isReplayRequest,
  normalizeText,
  tokenizeCommandLine,
};
