import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Tool definition for getting Stars balance
 */
export const telegramGetStarsBalanceTool: Tool = {
  name: "telegram_get_stars_balance",
  description:
    "Get your current Telegram Stars balance. Stars are Telegram's virtual currency used to buy gifts, tip creators, and purchase digital goods. Returns your total balance and any pending/withdrawable amounts.",
  parameters: Type.Object({}),
};

/**
 * Executor for telegram_get_stars_balance tool
 */
export const telegramGetStarsBalanceExecutor: ToolExecutor<{}> = async (
  _params,
  context
): Promise<ToolResult> => {
  try {
    const gramJsClient = context.bridge.getClient().getClient();

    // Get stars status for self
    const result: any = await gramJsClient.invoke(
      new Api.payments.GetStarsStatus({
        peer: new Api.InputPeerSelf(),
      })
    );

    return {
      success: true,
      data: {
        balance: result.balance?.amount?.toString() || "0",
        balanceNanos: result.balance?.nanos?.toString() || "0",
        // Additional fields if available
        subscriptionsMissingBalance: result.subscriptionsMissingBalance?.toString(),
        history: result.history?.length || 0,
      },
    };
  } catch (error) {
    console.error("Error getting Stars balance:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
