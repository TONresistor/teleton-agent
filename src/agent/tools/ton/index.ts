import { tonGetAddressTool, tonGetAddressExecutor } from "./get-address.js";
import { tonGetBalanceTool, tonGetBalanceExecutor } from "./get-balance.js";
import { tonPriceTool, tonPriceExecutor } from "./get-price.js";
import { tonSendTool, tonSendExecutor } from "./send.js";
import { tonGetTransactionsTool, tonGetTransactionsExecutor } from "./get-transactions.js";
import { tonMyTransactionsTool, tonMyTransactionsExecutor } from "./my-transactions.js";
import { tonChartTool, tonChartExecutor } from "./chart.js";
import { nftListTool, nftListExecutor } from "./nft-list.js";
import type { ToolEntry } from "../types.js";

export { tonGetAddressTool, tonGetAddressExecutor };
export { tonGetBalanceTool, tonGetBalanceExecutor };
export { tonPriceTool, tonPriceExecutor };
export { tonSendTool, tonSendExecutor };
export { tonGetTransactionsTool, tonGetTransactionsExecutor };
export { tonMyTransactionsTool, tonMyTransactionsExecutor };
export { tonChartTool, tonChartExecutor };
export { nftListTool, nftListExecutor };

export const tools: ToolEntry[] = [
  { tool: tonSendTool, executor: tonSendExecutor, scope: "dm-only" },
  { tool: tonGetAddressTool, executor: tonGetAddressExecutor },
  { tool: tonGetBalanceTool, executor: tonGetBalanceExecutor },
  { tool: tonPriceTool, executor: tonPriceExecutor },
  { tool: tonGetTransactionsTool, executor: tonGetTransactionsExecutor },
  { tool: tonMyTransactionsTool, executor: tonMyTransactionsExecutor },
  { tool: tonChartTool, executor: tonChartExecutor },
  { tool: nftListTool, executor: nftListExecutor },
];
