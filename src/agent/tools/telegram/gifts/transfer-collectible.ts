import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { DEAL_VERIFICATION_WINDOW_SECONDS } from "../../../../constants/limits.js";

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
  description: `Transfer a collectible gift you own to another user. Only works with upgraded collectible gifts (starGiftUnique), not regular gifts. The recipient will become the new owner.

IMPORTANT: Some collectibles require a Star fee to transfer (shown as transferStars in telegram_get_my_gifts).
- If transferStars is null/0: Transfer is FREE
- If transferStars has a value: That amount of Stars will be deducted from your balance

Use telegram_get_my_gifts to find your collectibles and their msgId.`,
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
    const verifiedDeal = context.db
      .prepare(
        `SELECT id FROM deals
         WHERE status = 'verified'
           AND agent_gives_type = 'gift'
           AND agent_gives_gift_id = ?
           AND user_telegram_id = ?
           AND user_payment_verified_at >= unixepoch() - ${DEAL_VERIFICATION_WINDOW_SECONDS}
           AND agent_sent_at IS NULL
         LIMIT 1`
      )
      .get(msgId.toString(), toUserId);

    if (!verifiedDeal) {
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
        console.log("Transfer requires payment, using payment flow...");

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
    console.error("Error transferring collectible:", error);

    const errorMsg = error instanceof Error ? error.message : String(error);

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
