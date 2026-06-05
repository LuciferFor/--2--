import { bindQq, itemAction, queryCard, queryInventory, resolveConfig } from "./core.mjs";

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
      description: "Optional natural command alias, such as /raid, 查下raid, /pvp, /地牢, /宗师, /热力图, /生涯, /名片, /战绩, /最近, /活动, /武器, /资料, /帮助. In this plugin, raid means the player's raid stats, not weekly rotator info.",
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
        "grandmasters",
        "raid_overview",
        "dungeon_overview",
        "heatmap",
        "activities",
        "latest_activity",
        "activity",
      ],
      description:
        "HTML-rendered image card type. Use help for command menu, career for all-mode career stats, crafting for craftable weapon patterns, catalysts for QQ OAuth catalyst progress, grandmasters for Grandmaster Nightfall stats, pvp for crucible/trials, dungeon_overview for per-dungeon clears/fastest, heatmap for activity distribution, activities for recent activity list, raid_overview for per-raid clears/fastest/flawless/day-one overview, latest_activity for one recent PGCR, activity for a known PGCR activityId.",
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
    { properties: { command: { enum: ["/帮助", "帮助", "菜单", "help"] } }, required: ["command"] },
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
        "Optional item search keyword. For natural language like 查仓库所有冲锋枪, pass the cleaned item name or type only, e.g. 冲锋枪. Normalize common aliases such as 微冲/SMG -> 冲锋枪, 喷子 -> 霰弹枪, 筒子 -> 火箭发射器.",
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

export function registerD2StatsRuntime(api, options = {}) {
  const logger = getLogger(api);
  const getConfig = () => resolveConfig(api.pluginConfig || options.config || {});

  api.registerTool(
    {
      name: "destiny2_card_query",
      description:
        "Return Destiny 2 stat data as an OpenClaw-rendered HTML PNG card. Except for card=help, always pass target, qq, senderQq, userId, or user_id. When a user says '@bot 查下raid', '/raid', '/地牢', or another command without a target, use the speaker's QQ/user_id as the target. In this plugin, raid means the player's raid stats, not weekly raid rotator/schedule info. Use card=help for the menu, card=career for career overview, card=crafting for craftable weapon patterns/锻造, card=catalysts for QQ OAuth catalyst progress/催化, card=grandmasters for Grandmaster Nightfall stats/宗师, card=pvp for PvP/trials, card=dungeon_overview for dungeon stats, card=heatmap for activity heatmap, card=activities for recent activity history, and card=raid_overview when the user asks for raid overview, per-raid clears, day-one, or flawless raid stats. Prefer this tool for Destiny 2 stats, PvP, trials, weapons, catalysts, crafting, grandmasters, profile, or recent activity. If a QQ number is unbound or lacks OAuth, the tool returns a 3-minute Bungie OAuth binding link.",
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
        "Query the bound QQ owner's Destiny 2 private inventory/vault/equipped items and return an image card or share page. Use view=vault for /仓库, view=equipped for /装备/当前装备/身上装备, view=inventory for /背包, and view=search for /仓库搜索 or 查仓库所有XX. For search, pass a cleaned q such as 冲锋枪, not 的所有冲锋枪. Requires QQ OAuth; if missing, returns a 3-minute Bungie OAuth binding link.",
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
}

function getLogger(api) {
  const logger = api?.runtime?.logging?.getChildLogger?.({ plugin: "d2stats" }, { level: "info" }) || api?.logger || console;
  return {
    info: (...args) => logger.info?.(...args),
    warn: (...args) => logger.warn?.(...args),
    error: (...args) => logger.error?.(...args),
  };
}
