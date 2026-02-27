import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { hasVerifiedDeal } from "../../../../deals/module.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for transferring a collectible
 */
interface TransferCollectibleParams {
  msgId: number;
  toUserId: string;
}

/**
 * Tool definition for transferring a collectible gift
 */
export const telegramTransferCollectibleTool: Tool = {
  name: "telegram_transfer_collectible",
  description:
    "Transfer a collectible gift to another user. Requires verified deal. May cost Stars (see transferStars in telegram_get_my_gifts). Collectibles only.",
  parameters: Type.Object({
    msgId: Type.Number({
      description:
        "The msgId of the collectible gift to transfer (from telegram_get_my_gifts). This is the message ID where the gift was received.",
    }),
    toUserId: Type.String({
      description: "User ID or @username of the recipient",
    }),
  }),
};

/**
 * Executor for telegram_transfer_collectible tool
 */
export const telegramTransferCollectibleExecutor: ToolExecutor<TransferCollectibleParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { msgId, toUserId } = params;

    // SECURITY: Check if there's a verified deal authorizing this transfer
    // This prevents social engineering attacks where users trick the agent into sending collectibles
    if (!hasVerifiedDeal(msgId.toString(), toUserId)) {
      return {
        success: false,
        error: `Security restriction: Cannot transfer collectibles without a verified deal. This tool is only available during authorized trades. If you want to trade, propose a deal first using deal_propose.`,
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    // Validate msgId
    if (!msgId || typeof msgId !== "number") {
      return {
        success: false,
        error:
          "Invalid msgId. Use telegram_get_my_gifts to get the correct msgId of your collectible.",
      };
    }

    // Get recipient as InputPeer (required by the API)
    const toUser = await gramJsClient.getInputEntity(toUserId);

    // Build the stargift input reference
    const stargiftInput = new Api.InputSavedStarGiftUser({
      msgId: msgId,
    });

    // First try free transfer
    try {
      await gramJsClient.invoke(
        new Api.payments.TransferStarGift({
          stargift: stargiftInput,
          toId: toUser,
        })
      );

      return {
        success: true,
        data: {
          msgId,
          transferredTo: toUserId,
          paidTransfer: false,
          message: "Collectible transferred successfully (free transfer)!",
        },
      };
    } catch (freeTransferError: any) {
      // If PAYMENT_REQUIRED, the transfer requires Stars - use payment flow
      if (freeTransferError?.errorMessage === "PAYMENT_REQUIRED") {
        log.info("Transfer requires payment, using payment flow...");

        // Create invoice for paid transfer
        const invoice = new Api.InputInvoiceStarGiftTransfer({
          stargift: stargiftInput,
          toId: toUser,
        });

        // Get payment form
        const form: any = await gramJsClient.invoke(
          new Api.payments.GetPaymentForm({
            invoice: invoice,
          })
        );

        // Extract transfer cost from form
        const transferCost = form.invoice?.prices?.[0]?.amount?.toString() || "unknown";

        // Complete the payment
        await gramJsClient.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice: invoice,
          })
        );

        return {
          success: true,
          data: {
            msgId,
            transferredTo: toUserId,
            paidTransfer: true,
            starsSpent: transferCost,
            message: `Collectible transferred successfully! ${transferCost} Stars were deducted.`,
          },
        };
      }

      // Re-throw if it's a different error
      throw freeTransferError;
    }
  } catch (error) {
    log.error({ err: error }, "Error transferring collectible");

    const errorMsg = getErrorMessage(error);

    if (errorMsg.includes("STARGIFT_NOT_FOUND")) {
      return {
        success: false,
        error:
          "Collectible not found. Make sure you own it and it's a collectible (upgraded gift).",
      };
    }

    if (errorMsg.includes("BALANCE_TOO_LOW")) {
      return {
        success: false,
        error:
          "Insufficient Stars balance to pay the transfer fee. Check your balance with telegram_get_stars_balance.",
      };
    }

    if (errorMsg.includes("PEER_ID_INVALID")) {
      return {
        success: false,
        error: "Invalid recipient. Make sure the user ID or username is correct.",
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
