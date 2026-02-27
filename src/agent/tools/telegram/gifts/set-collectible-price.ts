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
  odayId: string;
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
    odayId: Type.String({
      description: "The odayId of the collectible to list/unlist (from telegram_get_my_gifts)",
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
    const { odayId, price } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    if (!(Api.payments as any).UpdateStarGiftPrice) {
      return {
        success: false,
        error:
          "Setting collectible prices is not supported in the current Telegram API layer. A GramJS update is required.",
      };
    }

    const isListing = price !== undefined && price > 0;

    await gramJsClient.invoke(
      new (Api.payments as any).UpdateStarGiftPrice({
        stargift: new (Api as any).InputSavedStarGiftUser({
          odayId: BigInt(odayId),
        }),
        resellStars: isListing ? BigInt(price) : undefined,
      })
    );

    return {
      success: true,
      data: {
        odayId,
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

    return {
      success: false,
      error: errorMsg,
    };
  }
};
