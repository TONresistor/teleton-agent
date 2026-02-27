import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for buying a resale gift
 */
interface BuyResaleGiftParams {
  slug: string;
}

/**
 * Tool definition for buying from resale marketplace
 */
export const telegramBuyResaleGiftTool: Tool = {
  name: "telegram_buy_resale_gift",
  description:
    "Buy a collectible from the resale marketplace using Stars. Get slug from telegram_get_resale_gifts.",
  parameters: Type.Object({
    slug: Type.String({
      description: "The slug of the listing to purchase (from telegram_get_resale_gifts)",
    }),
  }),
};

/**
 * Executor for telegram_buy_resale_gift tool
 */
export const telegramBuyResaleGiftExecutor: ToolExecutor<BuyResaleGiftParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { slug } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    // Buy for self
    const toId = new Api.InputPeerSelf();

    const invoice = new Api.InputInvoiceStarGiftResale({
      slug,
      toId,
    });

    const form: any = await gramJsClient.invoke(new Api.payments.GetPaymentForm({ invoice }));

    // Complete the purchase
    await gramJsClient.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice,
      })
    );

    return {
      success: true,
      data: {
        slug,
        purchased: true,
        message: "Collectible purchased successfully! It's now in your collection.",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error buying resale gift");

    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes("BALANCE_TOO_LOW")) {
      return {
        success: false,
        error: "Insufficient Stars balance for this purchase.",
      };
    }
    if (errorMsg.includes("STARGIFT_NOT_FOUND")) {
      return {
        success: false,
        error: "Listing not found. It may have been sold or removed.",
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
