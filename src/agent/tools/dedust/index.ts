import { dedustQuoteTool, dedustQuoteExecutor } from "./quote.js";
import { dedustSwapTool, dedustSwapExecutor } from "./swap.js";
import { dedustPoolsTool, dedustPoolsExecutor } from "./pools.js";
import type { ToolEntry } from "../types.js";

export { dedustQuoteTool, dedustQuoteExecutor };
export { dedustSwapTool, dedustSwapExecutor };
export { dedustPoolsTool, dedustPoolsExecutor };

export const tools: ToolEntry[] = [
  { tool: dedustSwapTool, executor: dedustSwapExecutor },
  { tool: dedustQuoteTool, executor: dedustQuoteExecutor },
  { tool: dedustPoolsTool, executor: dedustPoolsExecutor },
];
