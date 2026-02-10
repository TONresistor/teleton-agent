/**
 * Market plugin module — wraps gift floor-price tools into a self-contained module.
 * MarketPriceService manages its own market.db, so no migrate() is needed here.
 */

import type { PluginModule } from "../agent/tools/types.js";
import { MarketPriceService } from "./price-service.js";
import {
  marketGetFloorTool,
  marketGetFloorExecutor,
  marketSearchTool,
  marketSearchExecutor,
  marketCheapestTool,
  marketCheapestExecutor,
  marketPriceHistoryTool,
  marketPriceHistoryExecutor,
} from "../agent/tools/telegram/market/index.js";

let marketService: MarketPriceService | null = null;

const marketModule: PluginModule = {
  name: "market",
  version: "1.0.0",

  configure(config) {
    if (config.market?.enabled || config.deals?.enabled) {
      marketService = new MarketPriceService(config.market);
    }
  },

  tools(config) {
    if (!config.market?.enabled && !config.deals?.enabled) return [];
    return [
      { tool: marketGetFloorTool, executor: marketGetFloorExecutor },
      { tool: marketSearchTool, executor: marketSearchExecutor },
      { tool: marketCheapestTool, executor: marketCheapestExecutor },
      { tool: marketPriceHistoryTool, executor: marketPriceHistoryExecutor },
    ];
  },

  async start() {
    if (marketService) {
      await marketService.start();
      const stats = marketService.getStats();
      console.log(`✅ Gifts Market: ${stats.collections} collections, ${stats.models} models`);
    } else {
      console.log(`⏭️  Gifts Market: disabled`);
    }
  },

  async stop() {
    if (marketService) {
      marketService.stop();
    }
  },
};

export default marketModule;

export function getMarketService(): MarketPriceService | null {
  return marketService;
}
