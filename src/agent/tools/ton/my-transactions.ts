import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet, getCachedTonClient } from "../../../ton/wallet-service.js";
import { Address } from "@ton/core";
import { formatTransactions } from "../../../ton/format-transactions.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

interface MyTransactionsParams {
  limit?: number;
}

export const tonMyTransactionsTool: Tool = {
  name: "ton_my_transactions",
  description: "Get your own wallet's transaction history.",
  category: "data-bearing",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of transactions to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

export const tonMyTransactionsExecutor: ToolExecutor<MyTransactionsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 10 } = params;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    const addressObj = Address.parse(walletData.address);

    const client = await getCachedTonClient();

    const transactions = await client.getTransactions(addressObj, {
      limit: Math.min(limit, 50),
    });

    const formatted = formatTransactions(transactions);

    return {
      success: true,
      data: {
        address: walletData.address,
        transactions: formatted,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in ton_my_transactions");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
