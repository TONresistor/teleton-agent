import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for setting collectible price
 */
interface SetCollectiblePriceParams {
  msgId: number;
  price?: number;
}

/**
 * Tool definition for setting collectible price
 */
export const telegramSetCollectiblePriceTool: Tool = {
  name: "telegram_set_collectible_price",
  description:
    "List/unlist a collectible for sale. Set price in Stars to list, omit or 0 to unlist. Collectibles only.",
  parameters: Type.Object({
    msgId: Type.Number({
      description: "The msgId of the collectible to list/unlist (from telegram_get_my_gifts)",
    }),
    price: Type.Optional(
      Type.Number({
        description: "Price in Stars. Omit or set to 0 to remove from sale.",
        minimum: 0,
      })
    ),
  }),
};

/**
 * Executor for telegram_set_collectible_price tool
 */
export const telegramSetCollectiblePriceExecutor: ToolExecutor<SetCollectiblePriceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { msgId, price } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const isListing = price !== undefined && price > 0;

    await gramJsClient.invoke(
      new Api.payments.UpdateStarGiftPrice({
        stargift: new Api.InputSavedStarGiftUser({ msgId }),
        resellAmount: new Api.StarsAmount({
          amount: BigInt(isListing ? price : 0) as any,
          nanos: 0,
        }),
      })
    );

    return {
      success: true,
      data: {
        msgId,
        action: isListing ? "listed" : "unlisted",
        price: isListing ? price : null,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error setting collectible price");

    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes("STARGIFT_NOT_FOUND")) {
      return {
        success: false,
        error: "Collectible not found. Make sure you own it.",
      };
    }

    const resellMatch = errorMsg.match(/STARGIFT_RESELL_TOO_EARLY_(\d+)/);
    if (resellMatch) {
      const seconds = parseInt(resellMatch[1], 10);
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const wait = hours > 0 ? `${hours}h${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;
      return {
        success: false,
        error: `Cannot list yet — Telegram requires waiting ${wait} before reselling. Try again later.`,
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
