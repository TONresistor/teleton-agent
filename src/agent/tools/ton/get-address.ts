import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getWalletAddress } from "../../../ton/wallet-service.js";

/**
 * Tool definition for ton_get_address
 */
export const tonGetAddressTool: Tool = {
  name: "ton_get_address",
  description:
    "Get your TON wallet address. Returns the address where you can receive TON cryptocurrency.",
  parameters: Type.Object({}),
};

/**
 * Executor for ton_get_address tool
 */
export const tonGetAddressExecutor: ToolExecutor<{}> = async (
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

    return {
      success: true,
      data: {
        address,
        message: `Your TON wallet address: ${address}`,
      },
    };
  } catch (error) {
    console.error("Error in ton_get_address:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
