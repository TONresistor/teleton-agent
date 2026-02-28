import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface GetStarsBalanceParams {
  ton?: boolean;
}

/**
 * Tool definition for getting Stars balance
 */
export const telegramGetStarsBalanceTool: Tool = {
  name: "telegram_get_stars_balance",
  description:
    "Retrieve your current Stars balance, or TON balance (internal ledger) with ton=true.",
  category: "data-bearing",
  parameters: Type.Object({
    ton: Type.Optional(
      Type.Boolean({
        description: "If true, returns TON balance instead of Stars balance.",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_stars_balance tool
 */
export const telegramGetStarsBalanceExecutor: ToolExecutor<GetStarsBalanceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const gramJsClient = context.bridge.getClient().getClient();

    const result: any = await gramJsClient.invoke(
      new Api.payments.GetStarsStatus({
        peer: new Api.InputPeerSelf(),
        ton: params.ton || undefined,
      })
    );

    const currency = params.ton ? "TON" : "Stars";

    return {
      success: true,
      data: {
        currency,
        balance: result.balance?.amount?.toString() || "0",
        balanceNanos: result.balance?.nanos?.toString() || "0",
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
