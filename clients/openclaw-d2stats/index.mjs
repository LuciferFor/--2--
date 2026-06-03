import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { registerD2StatsRuntime } from "./lib/runtime.mjs";

export default definePluginEntry({
  id: "d2stats",
  name: "Destiny 2 Stats",
  description: "Query Destiny 2 public stat cards as images.",
  register(api) {
    registerD2StatsRuntime(api);
  },
});

export * from "./lib/core.mjs";
export * from "./lib/runtime.mjs";
