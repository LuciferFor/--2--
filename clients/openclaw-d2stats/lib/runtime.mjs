import { bindQq, queryCard, resolveConfig } from "./core.mjs";

const cardQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      type: "string",
      description: "QQ number, BungieName#1234, membershipType:membershipId, or a long membershipId.",
    },
    card: {
      type: "string",
      enum: ["summary", "profile", "weapons", "raid_overview", "latest_activity", "activity"],
      description:
        "HTML-rendered image card type. Use raid_overview for per-raid clears/fastest/flawless/day-one overview, latest_activity for recent match/activity, activity for a known PGCR activityId.",
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
      description: "Optional raid_overview history pages to scan, default 1.",
    },
    pgcrLimit: {
      type: "number",
      description: "Optional raid_overview PGCR scan limit, default 20.",
    },
  },
  required: ["target"],
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
        "Return Destiny 2 public stat data as an OpenClaw-rendered HTML PNG card. Use card=raid_overview when the user asks for raid overview, per-raid clears, day-one, or flawless raid stats. Prefer this tool for Destiny 2 stats, PvP, trials, weapons, profile, or recent activity. If a QQ number is unbound, ask the user for BungieName#1234 or membershipType:membershipId.",
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
        "Bind a QQ number to a Destiny 2 player. Public self-binding only creates a binding and never overwrites an existing QQ binding.",
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
