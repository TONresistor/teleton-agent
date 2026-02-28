import { Type } from "@sinclair/typebox";
import { Address } from "@ton/core";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getWalletAddress } from "../../../ton/wallet-service.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
export const tonGetAddressTool: Tool = {
  name: "ton_get_address",
  description: "Return your TON wallet address in EQ format. No parameters needed.",
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

    // Display wallet in non-bounceable (UQ...) format — standard for user wallets
    const friendly = Address.parse(address).toString({ bounceable: false });

    return {
      success: true,
      data: {
        address: friendly,
        message: `Your TON wallet address: ${friendly}`,
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
