import { bindQq, queryCard, resolveConfig } from "./core.mjs";

const cardQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number, BungieName#1234, membershipType:membershipId, or a long membershipId. Not required for card=help.",
    },
    command: {
      type: "string",
      description: "Optional natural command alias, such as /raid, /pvp, /地牢, /宗师, /热力图, /生涯, /名片, /战绩, /最近, /活动, /武器, /资料, /帮助.",
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
      description: "Optional raid_overview or dungeon_overview history pages to scan. Dungeon defaults to 10.",
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
  required: ["qq"],
};

export function registerD2StatsRuntime(api, options = {}) {
  const logger = getLogger(api);
  const getConfig = () => resolveConfig(api.pluginConfig || options.config || {});

  api.registerTool(
    {
      name: "destiny2_card_query",
      description:
        "Return Destiny 2 stat data as an OpenClaw-rendered HTML PNG card. Use card=help for the menu, card=career for career overview, card=crafting for craftable weapon patterns/锻造, card=catalysts for QQ OAuth catalyst progress/催化, card=grandmasters for Grandmaster Nightfall stats/宗师, card=pvp for PvP/trials, card=dungeon_overview for dungeon stats, card=heatmap for activity heatmap, card=activities for recent activity history, and card=raid_overview when the user asks for raid overview, per-raid clears, day-one, or flawless raid stats. Prefer this tool for Destiny 2 stats, PvP, trials, weapons, catalysts, crafting, grandmasters, profile, or recent activity. If a QQ number is unbound or lacks OAuth, the tool returns a 3-minute Bungie OAuth binding link.",
      parameters: cardQueryParameters,
      async execute(_toolCallId, params, signal) {
        const config = getConfig();
        logger.info("d2stats.card query", { card: params?.card, hasTarget: Boolean(params?.target) });
        return queryCard(params, config, { signal, fetchImpl: options.fetchImpl });
      },
    },
    { optional: false },
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
}

function getLogger(api) {
  const logger = api?.runtime?.logging?.getChildLogger?.({ plugin: "d2stats" }, { level: "info" }) || api?.logger || console;
  return {
    info: (...args) => logger.info?.(...args),
    warn: (...args) => logger.warn?.(...args),
    error: (...args) => logger.error?.(...args),
  };
}
