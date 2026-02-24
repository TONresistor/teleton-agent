import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getWalletAddress } from "../../../ton/wallet-service.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
export const tonGetAddressTool: Tool = {
  name: "ton_get_address",
  description: "Get your TON wallet address.",
  parameters: Type.Object({}),
};
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
    log.error({ err: error }, "Error in ton_get_address");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
