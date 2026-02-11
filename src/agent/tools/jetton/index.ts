import { jettonBalancesTool, jettonBalancesExecutor } from "./balances.js";
import { jettonSwapTool, jettonSwapExecutor } from "./swap.js";
import { jettonSendTool, jettonSendExecutor } from "./send.js";
import { jettonInfoTool, jettonInfoExecutor } from "./info.js";
import { jettonPriceTool, jettonPriceExecutor } from "./price.js";
import { jettonSearchTool, jettonSearchExecutor } from "./search.js";
import { jettonQuoteTool, jettonQuoteExecutor } from "./quote.js";
import { jettonHoldersTool, jettonHoldersExecutor } from "./holders.js";
import { jettonHistoryTool, jettonHistoryExecutor } from "./history.js";
import { jettonTrendingTool, jettonTrendingExecutor } from "./trending.js";
import { jettonPoolsTool, jettonPoolsExecutor } from "./pools.js";
import type { ToolEntry } from "../types.js";

export { jettonBalancesTool, jettonBalancesExecutor };
export { jettonSwapTool, jettonSwapExecutor };
export { jettonSendTool, jettonSendExecutor };
export { jettonInfoTool, jettonInfoExecutor };
export { jettonPriceTool, jettonPriceExecutor };
export { jettonSearchTool, jettonSearchExecutor };
export { jettonQuoteTool, jettonQuoteExecutor };
export { jettonHoldersTool, jettonHoldersExecutor };
export { jettonHistoryTool, jettonHistoryExecutor };
export { jettonTrendingTool, jettonTrendingExecutor };
export { jettonPoolsTool, jettonPoolsExecutor };

export const tools: ToolEntry[] = [
  { tool: jettonSwapTool, executor: jettonSwapExecutor },
  { tool: jettonSendTool, executor: jettonSendExecutor, scope: "dm-only" },
  { tool: jettonBalancesTool, executor: jettonBalancesExecutor },
  { tool: jettonInfoTool, executor: jettonInfoExecutor },
  { tool: jettonPriceTool, executor: jettonPriceExecutor },
  { tool: jettonSearchTool, executor: jettonSearchExecutor },
  { tool: jettonQuoteTool, executor: jettonQuoteExecutor },
  { tool: jettonHoldersTool, executor: jettonHoldersExecutor },
  { tool: jettonHistoryTool, executor: jettonHistoryExecutor },
  { tool: jettonTrendingTool, executor: jettonTrendingExecutor },
  { tool: jettonPoolsTool, executor: jettonPoolsExecutor },
];
