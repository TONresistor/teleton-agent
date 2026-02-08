import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for get transactions
 */
interface GetTransactionsParams {
  limit?: number;
  inbound?: boolean;
  outbound?: boolean;
}

/**
 * Tool definition for getting Stars transactions
 */
export const telegramGetStarsTransactionsTool: Tool = {
  name: "telegram_get_stars_transactions",
  description:
    "Get your Telegram Stars transaction history. Shows all purchases, gifts sent/received, and other Star movements. Can filter by inbound (received) or outbound (spent) transactions.",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of transactions to return (default: 20)",
        minimum: 1,
        maximum: 100,
      })
    ),
    inbound: Type.Optional(
      Type.Boolean({
        description: "Only show inbound transactions (Stars received)",
      })
    ),
    outbound: Type.Optional(
      Type.Boolean({
        description: "Only show outbound transactions (Stars spent)",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_stars_transactions tool
 */
export const telegramGetStarsTransactionsExecutor: ToolExecutor<GetTransactionsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 20, inbound, outbound } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const result: any = await gramJsClient.invoke(
      new Api.payments.GetStarsTransactions({
        peer: new Api.InputPeerSelf(),
        inbound,
        outbound,
        offset: "",
        limit,
      })
    );

    const transactions = (result.history || []).map((tx: any) => ({
      id: tx.id,
      stars: tx.stars?.toString(),
      date: tx.date,
      type: tx.peer?.className || "unknown",
      description: tx.description || null,
      pending: tx.pending || false,
      failed: tx.failed || false,
      refund: tx.refund || false,
    }));

    return {
      success: true,
      data: {
        transactions,
        count: transactions.length,
        balance: result.balance?.toString(),
      },
    };
  } catch (error) {
    console.error("Error getting Stars transactions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
