/**
 * Casino plugin module — wraps existing casino tools into a self-contained module.
 * Uses its own casino.db file, fully isolated from main memory.db.
 */

import type { PluginModule } from "../agent/tools/types.js";
import { initCasinoConfig } from "./config.js";
import { openCasinoDb, closeCasinoDb, getCasinoDb } from "./db.js";
import { createDbWrapper } from "../utils/module-db.js";
import {
  casinoBalanceTool,
  casinoBalanceExecutor,
  casinoSpinTool,
  casinoSpinExecutor,
  casinoDiceTool,
  casinoDiceExecutor,
  casinoLeaderboardTool,
  casinoLeaderboardExecutor,
  casinoMyStatsTool,
  casinoMyStatsExecutor,
} from "../agent/tools/casino/index.js";

const withCasinoDb = createDbWrapper(getCasinoDb, "Casino");

const casinoModule: PluginModule = {
  name: "casino",
  version: "1.0.0",

  configure(config) {
    initCasinoConfig(config.casino);
  },

  tools(config) {
    if (!config.casino?.enabled) return [];
    return [
      { tool: casinoBalanceTool, executor: withCasinoDb(casinoBalanceExecutor) },
      { tool: casinoSpinTool, executor: withCasinoDb(casinoSpinExecutor) },
      { tool: casinoDiceTool, executor: withCasinoDb(casinoDiceExecutor) },
      { tool: casinoLeaderboardTool, executor: withCasinoDb(casinoLeaderboardExecutor) },
      { tool: casinoMyStatsTool, executor: withCasinoDb(casinoMyStatsExecutor) },
    ];
  },

  async start(context) {
    if (!context.config.casino?.enabled) return;
    openCasinoDb();
    console.log("✅ Casino DB: casino.db initialized");
  },

  async stop() {
    closeCasinoDb();
  },
};

export default casinoModule;
