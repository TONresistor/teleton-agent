import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { TonClient } from "@ton/ton";
import { Address } from "@ton/core";
import { getCachedHttpEndpoint } from "../../../ton/endpoint.js";
import { formatTransactions } from "../../../ton/format-transactions.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface GetTransactionsParams {
  address: string;
  limit?: number;
}
export const tonGetTransactionsTool: Tool = {
  name: "ton_get_transactions",
  description: "Get transaction history for any TON address.",
  category: "data-bearing",
  parameters: Type.Object({
    address: Type.String({
      description: "TON address to get transactions for (EQ... or UQ... format)",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of transactions to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};
export const tonGetTransactionsExecutor: ToolExecutor<GetTransactionsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { address, limit = 10 } = params;

    let addressObj: Address;
    try {
      addressObj = Address.parse(address);
    } catch (e) {
      return {
        success: false,
        error: `Invalid address: ${address}`,
      };
    }

    const endpoint = await getCachedHttpEndpoint();
    const client = new TonClient({ endpoint });

    const transactions = await client.getTransactions(addressObj, {
      limit: Math.min(limit, 50),
    });

    const formatted = formatTransactions(transactions);

    return {
      success: true,
      data: {
        address,
        transactions: formatted,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in ton_get_transactions");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
