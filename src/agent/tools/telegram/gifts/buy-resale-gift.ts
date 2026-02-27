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
  odayId: string;
}

/**
 * Tool definition for buying from resale marketplace
 */
export const telegramBuyResaleGiftTool: Tool = {
  name: "telegram_buy_resale_gift",
  description:
    "Buy a collectible from the resale marketplace using Stars. Get odayId from telegram_get_resale_gifts.",
  parameters: Type.Object({
    odayId: Type.String({
      description: "The odayId of the listing to purchase (from telegram_get_resale_gifts)",
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
    const { odayId } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    if (!(Api as any).InputInvoiceStarGiftResale) {
      return {
        success: false,
        error:
          "Resale gift purchasing is not supported in the current Telegram API layer. A GramJS update is required.",
      };
    }

    // Get payment form for the resale gift
    const stargiftInput = new (Api as any).InputSavedStarGiftUser({
      odayId: BigInt(odayId),
    });

    const invoiceData = {
      stargift: stargiftInput,
    };

    const form: any = await gramJsClient.invoke(
      new Api.payments.GetPaymentForm({
        invoice: new (Api as any).InputInvoiceStarGiftResale(invoiceData),
      })
    );

    // Complete the purchase
    await gramJsClient.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice: new (Api as any).InputInvoiceStarGiftResale(invoiceData),
      })
    );

    return {
      success: true,
      data: {
        odayId,
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
