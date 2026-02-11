import { dexQuoteTool, dexQuoteExecutor } from "./smart-quote.js";
import { dexSwapTool, dexSwapExecutor } from "./smart-swap.js";
import type { ToolEntry } from "../types.js";

export { dexQuoteTool, dexQuoteExecutor };
export { dexSwapTool, dexSwapExecutor };

export const tools: ToolEntry[] = [
  { tool: dexSwapTool, executor: dexSwapExecutor },
  { tool: dexQuoteTool, executor: dexQuoteExecutor },
];
