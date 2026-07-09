import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

/**
 * Parameters for buying a resale gift
 */
interface BuyResaleGiftParams {
  slug: string;
  maxPriceStars: number;
}

/**
 * Tool definition for buying from resale marketplace
 */
export const telegramBuyResaleGiftTool: Tool = {
  name: "telegram_buy_resale_gift",
  description:
    "Buy a collectible from the resale marketplace using Stars. Get slug and priceStars from telegram_get_resale_gifts, then set maxPriceStars to the exact maximum approved by the owner.",
  parameters: Type.Object({
    slug: Type.String({
      description: "The slug of the listing to purchase (from telegram_get_resale_gifts)",
    }),
    maxPriceStars: Type.Integer({
      description:
        "Maximum Stars the owner approved for this purchase. The live payment form is checked before spending.",
      minimum: 1,
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
    const { slug, maxPriceStars } = params;
    const gramJsClient = getClient(context.bridge);

    // Buy for self
    const toId = new Api.InputPeerSelf();

    const invoice = new Api.InputInvoiceStarGiftResale({
      slug,
      toId,
    });

    const form = await gramJsClient.invoke(new Api.payments.GetPaymentForm({ invoice }));
    if (form.invoice.currency !== "XTR") {
      return {
        success: false,
        error: `Unsupported resale currency: ${form.invoice.currency}. This tool only purchases with Stars.`,
      };
    }

    const livePrice = form.invoice.prices.reduce(
      (total, price) => total + BigInt(price.amount.toString()),
      0n
    );
    if (livePrice > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { success: false, error: "Live resale price is too large to verify safely" };
    }
    const livePriceStars = Number(livePrice);
    if (livePriceStars > maxPriceStars) {
      return {
        success: false,
        error: `Live resale price is ${livePriceStars} Stars, above the approved maximum of ${maxPriceStars} Stars. Request a new approval.`,
      };
    }

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
        priceStars: livePriceStars,
        message: `Collectible purchased for ${livePriceStars} Stars. It's now in your collection.`,
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
