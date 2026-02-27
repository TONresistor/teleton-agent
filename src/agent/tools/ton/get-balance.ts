import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getWalletAddress, getWalletBalance } from "../../../ton/wallet-service.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
export const tonGetBalanceTool: Tool = {
  name: "ton_get_balance",
  description: "Get your current TON wallet balance.",
  parameters: Type.Object({}),
  category: "data-bearing",
};
export const tonGetBalanceExecutor: ToolExecutor<{}> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const address = getWalletAddress();

    if (!address) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    const balance = await getWalletBalance(address);

    if (!balance) {
      return {
        success: false,
        error: "Failed to fetch balance from TON blockchain. Network might be unavailable.",
      };
    }

    return {
      success: true,
      data: {
        address,
        balance: balance.balance,
        balanceNano: balance.balanceNano,
        message: `Your wallet balance: ${balance.balance} TON`,
        summary: `${balance.balance} TON (${balance.balanceNano} nanoTON)`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in ton_get_balance");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
