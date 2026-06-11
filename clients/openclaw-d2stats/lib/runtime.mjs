import {
  applyLoadoutOptimizer,
  bindQq,
  itemAction,
  manageLoadouts,
  queryCard,
  queryInventory,
  queryLoadoutOptimizer,
  resolveConfig,
} from "./core.mjs";
import { executeD2Command } from "./command-gateway.mjs";

const senderQqProperties = {
  senderQq: {
    type: "string",
    description: "Sender QQ number from the chat adapter. Use this as the query target when the user says '/raid', '查下raid', '/地牢', or '查我' without an explicit target.",
  },
  userId: {
    type: "string",
    description: "OneBot sender user_id when it is the user's QQ number. Use it as the query QQ for command-only personal Destiny 2 queries.",
  },
  user_id: {
    type: "string",
    description: "OneBot sender user_id alias when it is the user's QQ number.",
  },
};

const commandParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    commandLine: {
      type: "string",
      description:
        "Standard Destiny 2 command line, such as --help, /d2help, --bind, /d2bind, --raid, --pvp, --dungeon, --gm, --vault, --equipped, --search --weapon-type 手炮 --rpm 120 --bucket vault, --perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪, --catalyst 虫狙, or --loadouts. Prefer this single command tool over the legacy individual tools.",
    },
    command: {
      type: "string",
      description: "Alias for commandLine.",
    },
    ...senderQqProperties,
    qq: {
      type: "string",
      description: "Optional sender QQ. Used as the target when commandLine does not include a target.",
    },
    chatType: {
      type: "string",
      enum: ["private", "group", "cli", "unknown"],
      description: "Optional chat type for logging.",
    },
    chatId: {
      type: "string",
      description: "Optional chat id for logging.",
    },
  },
  anyOf: [{ required: ["commandLine"] }, { required: ["command"] }],
  required: [],
};

const cardQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description:
        "Required for every stat card except card=help. Use the target after the command, for example '/地牢 1665240495', '/raid Lucifer#8571', or '3:4611686018494693796'.",
    },
    qq: {
      type: "string",
      description:
        "Optional sender QQ alias. If the user says '/地牢' or '查我' and OpenClaw knows the sender QQ, pass it here or as target.",
    },
    ...senderQqProperties,
    command: {
      type: "string",
      description: "Optional natural command alias, such as /d2help, /d2bind, /绑定命运2, /raid, 查下raid, /pvp, /地牢, /宗师, /热力图, /生涯, /名片, /战绩, /最近, /活动, /武器, /资料. In this plugin, raid means the player's raid stats, not weekly rotator info.",
    },
    card: {
      type: "string",
      enum: [
        "help",
        "summary",
        "career",
        "profile",
        "namecard",
        "pvp",
        "weapons",
        "crafting",
        "catalysts",
        "catalyst_status",
        "catalyst_info",
        "item_info",
        "perk_weapons",
        "grandmasters",
        "raid_overview",
        "dungeon_overview",
        "heatmap",
        "activities",
        "latest_activity",
        "activity",
      ],
      description:
        "HTML-rendered image card type. Use help for command menu, career for all-mode career stats, crafting for craftable weapon patterns, catalysts for QQ OAuth full catalyst progress, catalyst_status for one weapon's personal catalyst obtained/completed/progress/effect status, catalyst_info for public exotic catalyst effect lookup by weapon name, item_info for public Bungie Manifest weapon/item details such as 查个武器，极高反射, perk_weapons for public Perk -> possible weapon roll pool lookup such as 查爆破专家斩首武器的冲锋枪, grandmasters for Grandmaster Nightfall stats, pvp for crucible/trials, dungeon_overview for per-dungeon clears/fastest, heatmap for activity distribution, activities for recent activity list, raid_overview for per-raid clears/fastest/flawless/day-one overview, latest_activity for one recent PGCR, activity for a known PGCR activityId.",
    },
    q: {
      type: "string",
      description: "Weapon/item name or search text for card=catalyst_status, card=catalyst_info, or card=item_info, for example 虫狙, 挽歌, or 极高反射.",
    },
    perks: {
      type: "array",
      items: { type: "string" },
      description: "Perk names for card=perk_weapons, for example [\"爆破专家\", \"斩首武器\"]. Multi-perk lookup uses AND.",
    },
    perk: {
      type: "string",
      description: "Comma-separated perk names for card=perk_weapons.",
    },
    weaponType: {
      type: "string",
      description: "Optional weapon type filter for inventory search or card=perk_weapons, such as 冲锋枪, 霰弹枪, 手炮.",
    },
    rpm: {
      type: "number",
      description: "Optional RPM filter for inventory search or card=perk_weapons.",
    },
    craftable: {
      type: "boolean",
      description: "Optional craftable-only filter for card=perk_weapons.",
    },
    mode: {
      type: "string",
      enum: ["all", "raid", "dungeon", "trials", "pvp", "gambit"],
      description: "Optional Destiny mode for summary and latest_activity cards.",
    },
    activityId: {
      type: "string",
      description: "PGCR activity ID, required when card is activity unless target is the activity ID.",
    },
    historyPages: {
      type: "number",
      description: "Optional raid_overview or dungeon_overview history pages to scan. Dungeon defaults to 5 for faster first queries.",
    },
    pgcrLimit: {
      type: "number",
      description: "Optional raid_overview, dungeon_overview, or grandmasters PGCR scan limit.",
    },
    season: {
      type: "string",
      enum: ["current", "all"],
      description: "Optional grandmasters season scope, default current.",
    },
    pages: {
      type: "number",
      description: "Optional heatmap recent activity history pages to scan when range=recent, default 2.",
    },
    range: {
      type: "string",
      enum: ["all", "year", "recent"],
      description: "Optional heatmap range. Use all for career-long cached calendar, year for a single year, recent for the old quick scan.",
    },
    year: {
      type: "number",
      description: "Optional heatmap year when range=year.",
    },
    timezone: {
      type: "string",
      description: "Optional heatmap timezone, default Asia/Shanghai.",
    },
  },
  anyOf: [
    { required: ["target"] },
    { required: ["qq"] },
    { required: ["senderQq"] },
    { required: ["userId"] },
    { required: ["user_id"] },
    { properties: { card: { const: "help" } }, required: ["card"] },
    { properties: { card: { const: "catalyst_status" } }, required: ["card", "q"] },
    { properties: { card: { const: "catalyst_info" } }, required: ["card", "q"] },
    { properties: { card: { const: "item_info" } }, required: ["card", "q"] },
    { properties: { card: { const: "perk_weapons" } }, required: ["card"] },
    { properties: { command: { enum: ["/d2help", "/d2帮助", "命运2帮助", "d2菜单", "/帮助", "帮助", "菜单", "help"] } }, required: ["command"] },
  ],
  required: [],
};

const bindQqParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    qq: {
      type: "string",
      description: "QQ number to bind.",
    },
    ...senderQqProperties,
    target: {
      type: "string",
      description: "BungieName#1234 or membershipType:membershipId.",
    },
    bungieName: {
      type: "string",
      description: "Optional BungieName#1234.",
    },
    membershipType: {
      type: "number",
      description: "Optional Destiny membership type.",
    },
    membershipId: {
      type: "string",
      description: "Optional Destiny membership ID.",
    },
  },
  anyOf: [{ required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: [],
};

const inventoryQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number only. Inventory requires the QQ owner's Bungie OAuth authorization.",
    },
    qq: {
      type: "string",
      description: "Optional sender QQ alias. Use this when the user says '/仓库', '/装备', or '查我' and OpenClaw knows the sender QQ.",
    },
    ...senderQqProperties,
    q: {
      type: "string",
      description:
        "Optional leftover item-name or perk keyword only. Do not put structured conditions here: for 120射速手炮, pass weaponType=手炮 and rpm=120, with q empty unless an item name remains.",
    },
    query: {
      type: "string",
      description: "Optional alias for q.",
    },
    view: {
      type: "string",
      enum: ["overview", "vault", "equipped", "inventory", "search"],
      description: "Image layout: overview, full vault, currently equipped by character, character inventory, or search results.",
    },
    bucket: {
      type: "string",
      enum: ["all", "vault", "inventory", "equipped"],
      description: "Optional inventory scope. Use vault with view=vault, equipped with view=equipped, inventory with view=inventory.",
    },
    characterId: {
      type: "string",
      description: "Optional Destiny character ID filter.",
    },
    weaponType: {
      type: "string",
      description: "Optional weapon type filter. Normalize aliases such as 微冲/SMG -> 冲锋枪, 喷子 -> 霰弹枪, 筒子 -> 火箭发射器, HC/hand cannon -> 手炮.",
    },
    rpm: {
      type: "number",
      description: "Optional exact weapon RPM / 射速 filter. For 120射速手炮 or 120rpm hc, pass 120.",
    },
    slot: {
      type: "string",
      description: "Optional inventory slot filter such as 动能武器、能量武器、威能武器.",
    },
    damageType: {
      type: "string",
      description: "Optional damage element filter if known, such as 火、虚空、冰影、缚丝.",
    },
    perk: {
      type: "string",
      description: "Optional selected/reusable perk keyword filter.",
    },
  },
  anyOf: [{ required: ["target"] }, { required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: [],
};

const itemActionParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number only. Equipment operations require the QQ owner's Bungie OAuth authorization.",
    },
    qq: {
      type: "string",
      description: "Optional explicit QQ number; same as target.",
    },
    ...senderQqProperties,
    action: {
      type: "string",
      enum: ["transfer", "equip", "equip_items", "lock", "unlock", "equip_loadout"],
      description: "Operation to perform.",
    },
    command: {
      type: "string",
      description: "Natural command alias, such as /装备, /转移, /锁定, /解锁, /套装.",
    },
    itemId: {
      type: "string",
      description: "Destiny itemInstanceId from inventory query.",
    },
    itemIds: {
      type: "array",
      items: { type: "string" },
      description: "Destiny itemInstanceIds for bulk equip.",
    },
    itemReferenceHash: {
      type: "number",
      description: "Destiny itemHash, required for transfer.",
    },
    stackSize: {
      type: "number",
      description: "Transfer stack size, default 1.",
    },
    transferToVault: {
      type: "boolean",
      description: "For transfer: true moves to vault, false moves from vault to character.",
    },
    characterId: {
      type: "string",
      description: "Destination/equipping Destiny character ID.",
    },
    loadoutIndex: {
      type: "number",
      description: "In-game loadout index, 0-9.",
    },
    confirm: {
      type: "boolean",
      description: "Must be true to execute. Omit or false returns a confirmation prompt only.",
    },
  },
  anyOf: [{ required: ["target"] }, { required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: ["action"],
};

const loadoutOptimizeParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number only. Use the speaker's QQ when the user says 我/查我/给我配装.",
    },
    qq: {
      type: "string",
      description: "Optional explicit QQ number; same as target.",
    },
    ...senderQqProperties,
    className: {
      type: "string",
      description: "Required character class after clarification: 术士, 猎人, or 泰坦. If missing, the tool asks the user which class.",
    },
    targetStats: {
      type: "object",
      additionalProperties: {
        type: "number",
      },
      description: "Armor 3.0 target stats. Do not invent defaults; ask the user if missing. Supports Chinese keys 生命值, 近战, 手雷, 超能, 职业, 武器 and legacy aliases.",
    },
    health: { type: "number", description: "Optional 生命值 target, 0-200." },
    melee: { type: "number", description: "Optional 近战 target, 0-200." },
    grenade: { type: "number", description: "Optional 手雷 target, 0-200." },
    super: { type: "number", description: "Optional 超能 target, 0-200." },
    class: { type: "number", description: "Optional 职业 target, 0-200." },
    weapon: { type: "number", description: "Optional 武器 target, 0-200." },
    recovery: { type: "number", description: "Legacy alias for 职业 target." },
    discipline: { type: "number", description: "Legacy alias for 手雷 target." },
    strength: { type: "number", description: "Legacy alias for 近战 target." },
    mobility: { type: "number", description: "Legacy alias for 武器 target." },
    resilience: { type: "number", description: "Legacy alias for 生命值 target." },
    intellect: { type: "number", description: "Legacy alias for 超能 target." },
    includeCurrentSubclassFragments: {
      type: "boolean",
      description: "Whether to simulate current subclass fragment stat changes. Default true.",
    },
    simulateStatMods: {
      type: "boolean",
      description: "Whether to simulate common +10/+5 armor stat mods. Default true.",
    },
    limit: {
      type: "number",
      description: "Maximum candidate builds to return, default 3.",
    },
  },
  anyOf: [{ required: ["target"] }, { required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: [],
};

const loadoutApplyParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number only. Must be the same sender QQ that owns the recent optimizer session.",
    },
    qq: {
      type: "string",
      description: "Optional explicit QQ number; same as target.",
    },
    ...senderQqProperties,
    sessionId: {
      type: "string",
      description: "sessionId returned by destiny2_loadout_optimize.",
    },
    buildId: {
      type: "string",
      description: "Build id such as b1. Natural values like 第1套 can be passed as rank/index instead.",
    },
    rank: {
      type: "number",
      description: "Alternative build rank, e.g. 1.",
    },
    index: {
      type: "number",
      description: "Alternative build index, e.g. 1.",
    },
    characterId: {
      type: "string",
      description: "Optional target character ID; defaults to the character in the optimizer session.",
    },
    confirm: {
      type: "boolean",
      description: "Must be true to execute. Omit or false returns a confirmation prompt only.",
    },
  },
  anyOf: [{ required: ["target"] }, { required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: ["sessionId"],
};

const loadoutManageParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number only. Loadout read/save/equip operations require the QQ owner's Bungie OAuth authorization.",
    },
    qq: {
      type: "string",
      description: "Optional explicit QQ number; same as target.",
    },
    ...senderQqProperties,
    operation: {
      type: "string",
      enum: ["list", "show", "equip_bungie", "snapshot_bungie", "rename_bungie", "clear_bungie", "save_local", "apply_local", "delete_local"],
      description:
        "Loadout management operation. Use list/show for reading requests such as 读取我的配装/查看配装/游戏内配装/本地配装; reading must return an image or share page, not a plain text summary. Use save_local for 保存当前装备为XX, snapshot_bungie only when the user explicitly says 保存到游戏内第N槽, equip_bungie for 装备游戏内第N套, apply_local for 应用本地配装, delete_local for 删除本地配装.",
    },
    command: {
      type: "string",
      description: "Natural command alias such as /套装列表, 读取我的配装, 保存当前装备为日落套, 保存到游戏内第2槽, 装备第2套, 应用日落套.",
    },
    idOrName: {
      type: "string",
      description: "Saved local loadout id or name for show/apply_local/delete_local.",
    },
    savedLoadoutId: {
      type: "string",
      description: "Alias for idOrName.",
    },
    name: {
      type: "string",
      description: "Local loadout name when saving, or a display label for relevant commands.",
    },
    loadoutName: {
      type: "string",
      description: "Alias for name.",
    },
    characterId: {
      type: "string",
      description: "Destiny character ID. Required for Bungie slot writes/equips; local save defaults to the latest played character.",
    },
    loadoutIndex: {
      type: "number",
      description: "Bungie in-game loadout index, 0-9. 第1槽 should be 0.",
    },
    optimizerSessionId: {
      type: "string",
      description: "Optional optimizer session id when saving a build result to the local loadout library.",
    },
    optimizerBuildId: {
      type: "string",
      description: "Optional optimizer build id when saving a build result to the local loadout library.",
    },
    source: {
      type: "string",
      description: "Optional source label, such as current_equipped or optimizer.",
    },
    notes: {
      type: "string",
      description: "Optional saved loadout notes.",
    },
    nameHash: { type: "number", description: "Bungie loadout name hash for rename_bungie." },
    iconHash: { type: "number", description: "Bungie loadout icon hash for rename_bungie." },
    colorHash: { type: "number", description: "Bungie loadout color hash for rename_bungie." },
    overwrite: {
      type: "boolean",
      description: "Whether save_local may overwrite an existing local saved loadout with the same name.",
    },
    confirm: {
      type: "boolean",
      description: "Must be true to execute write operations. Omit or false returns a confirmation prompt only.",
    },
  },
  anyOf: [{ required: ["target"] }, { required: ["qq"] }, { required: ["senderQq"] }, { required: ["userId"] }, { required: ["user_id"] }],
  required: ["operation"],
};

export function registerD2StatsRuntime(api, options = {}) {
  const logger = getLogger(api);
  const getConfig = () => resolveConfig(api.pluginConfig || options.config || {});

  api.registerTool(
    {
      name: "destiny2_command",
      description:
        "Deterministic Destiny 2 command gateway. Use this first for all D2 requests: --help or /d2help for the D2 menu, --bind or /d2bind for a QQ -> Bungie OAuth binding link, --raid, --pvp, --dungeon, --gm, --vault, --equipped, --search with structured filters, --item <weapon/item>, --perk-weapons 爆破专家,斩首武器 --weapon-type 冲锋枪, --catalysts, --catalyst <weapon>, --catalyst-info <weapon>, --loadouts, and --optimize. If no target is in commandLine, pass senderQq/userId as the QQ target. Public weapon/item/source questions should use --item; public Perk -> possible weapon questions should use --perk-weapons; do both before any web search unless the user explicitly asks for third-party/web strategy info. Read commands return an image or share page; OAuth-only commands return a 3-minute binding link when needed.",
      parameters: commandParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.command", { commandLine: params?.commandLine || params?.command || "" });
        return executeD2Command(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false, timeoutMs: 120000 },
  );

  api.registerTool(
    {
      name: "destiny2_card_query",
      description:
        "Return Destiny 2 stat data as an OpenClaw-rendered HTML PNG card. Except for card=help, card=catalyst_info, card=item_info, and card=perk_weapons, always pass target, qq, senderQq, userId, or user_id. When a user says '@bot 查下raid', '/raid', '/地牢', or another command without a target, use the speaker's QQ/user_id as the target. In this plugin, raid means the player's raid stats, not weekly raid rotator/schedule info. Use card=help for the menu, card=career for career overview, card=crafting for craftable weapon patterns/锻造, card=item_info with q=item name for public Manifest weapon/item/source queries such as 查个武器，极高反射, card=perk_weapons with perks/weaponType for public Perk -> possible weapon roll pool lookup such as 查爆破专家斩首武器的冲锋枪, card=catalysts for QQ OAuth full catalyst progress/我的催化进度, card=catalyst_status with q=weapon name for one weapon's personal catalyst obtained/completed/progress/effect status such as 查询下虫狙的催化, card=catalyst_info with q=weapon name only for public static catalyst effect lookup such as 挽歌催化效果是什么, card=grandmasters for Grandmaster Nightfall stats/宗师, card=pvp for PvP/trials, card=dungeon_overview for dungeon stats, card=heatmap for activity heatmap, card=activities for recent activity history, and card=raid_overview when the user asks for raid overview, per-raid clears, day-one, or flawless raid stats. Prefer destiny2_command for Destiny 2 requests. If a QQ number is unbound or lacks OAuth, the tool returns a 3-minute Bungie OAuth binding link.",
      parameters: cardQueryParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.card query", { card: params?.card, hasTarget: Boolean(params?.target || params?.qq) });
        return queryCard(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false, timeoutMs: 120000 },
  );

  api.registerTool(
    {
      name: "destiny2_bind_qq",
      description:
        "Bind a QQ number to a Destiny 2 player. If no BungieName or membership ID is provided, return a 3-minute Bungie OAuth binding link. Public self-binding only creates a binding and never overwrites an existing QQ binding.",
      parameters: bindQqParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.bind qq", { hasQq: Boolean(params?.qq) });
        return bindQq(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false },
  );

  api.registerTool(
    {
      name: "destiny2_inventory_query",
      description:
        "Query the bound QQ owner's Destiny 2 private inventory/vault/equipped items and return an image card or share page. Use view=vault for /仓库, view=equipped for /装备/当前装备/身上装备, view=inventory for /背包, and view=search for /仓库搜索 or 查仓库所有XX. For structured searches, pass fields such as weaponType=手炮 and rpm=120; q is only leftover item/perk text. Requires QQ OAuth; if missing, returns a 3-minute Bungie OAuth binding link.",
      parameters: inventoryQueryParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.inventory query", { hasTarget: Boolean(params?.target), hasQuery: Boolean(params?.q || params?.query) });
        return queryInventory(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false },
  );

  api.registerTool(
    {
      name: "destiny2_item_action",
      description:
        "Safely operate the bound QQ owner's Destiny 2 equipment: transfer, equip, bulk equip, lock/unlock, or equip in-game loadout. Never use for arbitrary membership IDs. First call without confirm=true to ask for confirmation; only execute after explicit user confirmation.",
      parameters: itemActionParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.item action", { action: params?.action, confirmed: params?.confirm === true });
        return itemAction(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false },
  );

  api.registerTool(
    {
      name: "destiny2_loadout_optimize",
      description:
        "Search the bound QQ owner's inventory/vault/equipped armor for Destiny 2 Armor 3.0 builds. Use for /配装, 三百套, or questions like 生命值+手雷+武器有没有套装. If className or target stats are missing, ask the user to provide them. Requires QQ OAuth; if missing, returns a 3-minute Bungie OAuth binding link.",
      parameters: loadoutOptimizeParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.loadout optimize", { hasTarget: Boolean(params?.target || params?.qq), className: params?.className });
        return queryLoadoutOptimizer(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false, timeoutMs: 120000 },
  );

  api.registerTool(
    {
      name: "destiny2_loadout_apply",
      description:
        "Apply an armor-only build returned by destiny2_loadout_optimize. Only use for the same sender QQ and only after the user explicitly confirms. This equips armor only; it does not modify mods, sockets, subclass, or fragments.",
      parameters: loadoutApplyParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.loadout apply", { confirmed: params?.confirm === true, buildId: params?.buildId || params?.rank || params?.index });
        return applyLoadoutOptimizer(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false, timeoutMs: 120000 },
  );

  api.registerTool(
    {
      name: "destiny2_loadout_manage",
      description:
        "Read, save, equip, rename, or delete the bound QQ owner's Destiny 2 loadouts. Use for /套装列表, 读取我的配装, 查看配装, 游戏内配装, 本地配装, 保存当前装备为XX, 保存到游戏内第N槽, 装备第N套, 应用本地配装, 删除本地配装. Reading returns an image/share page and must not be summarized as ordinary chat. Every write operation must first be called without confirm=true to show a confirmation; execute only after explicit confirmation. Requires QQ OAuth; if missing, returns a 3-minute Bungie binding link.",
      parameters: loadoutManageParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.loadout manage", { operation: params?.operation, confirmed: params?.confirm === true });
        return manageLoadouts(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false, timeoutMs: 120000 },
  );
}

function getLogger(api) {
  const logger = api?.runtime?.logging?.getChildLogger?.({ plugin: "d2stats" }, { level: "info" }) || api?.logger || console;
  return {
    info: (...args) => logger.info?.(...args),
    warn: (...args) => logger.warn?.(...args),
    error: (...args) => logger.error?.(...args),
  };
}
