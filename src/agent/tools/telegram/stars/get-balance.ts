import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Tool definition for getting Stars balance
 */
export const telegramGetStarsBalanceTool: Tool = {
  name: "telegram_get_stars_balance",
  description: "Get your current Telegram Stars balance.",
  category: "data-bearing",
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
    log.error({ err: error }, "Error getting Stars balance");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
