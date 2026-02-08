import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
    "Purchase a collectible gift from the resale marketplace. Uses Stars from your balance to buy at the listed price. After purchase, the collectible becomes yours. Use telegram_get_resale_gifts to browse available listings and find odayId.",
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
    console.error("Error buying resale gift:", error);

    const errorMsg = error instanceof Error ? error.message : String(error);
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
