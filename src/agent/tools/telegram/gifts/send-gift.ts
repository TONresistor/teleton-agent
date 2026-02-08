import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { DEAL_VERIFICATION_WINDOW_SECONDS } from "../../../../constants/limits.js";

/**
 * Parameters for sending a gift
 */
interface SendGiftParams {
  userId: string;
  giftId: string;
  message?: string;
  anonymous?: boolean;
}

/**
 * Tool definition for sending a Star Gift
 */
export const telegramSendGiftTool: Tool = {
  name: "telegram_send_gift",
  description:
    "Send a Star Gift to another user. First use telegram_get_available_gifts to see available gifts and their IDs. Limited gifts are rare and can become collectibles. The gift will appear on the recipient's profile unless they hide it. Costs Stars from your balance.",
  parameters: Type.Object({
    userId: Type.String({
      description: "User ID or @username to send the gift to",
    }),
    giftId: Type.String({
      description: "ID of the gift to send (from telegram_get_available_gifts)",
    }),
    message: Type.Optional(
      Type.String({
        description: "Optional personal message to include with the gift (max 255 chars)",
        maxLength: 255,
      })
    ),
    anonymous: Type.Optional(
      Type.Boolean({
        description: "Send anonymously (recipient won't see who sent it). Default: false",
      })
    ),
  }),
};

/**
 * Executor for telegram_send_gift tool
 */
export const telegramSendGiftExecutor: ToolExecutor<SendGiftParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { userId, giftId, message, anonymous = false } = params;

    // SECURITY: Check if there's a verified deal authorizing this gift send
    // This prevents social engineering attacks where users trick the agent into sending gifts
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
      .get(giftId, userId);

    if (!verifiedDeal) {
      return {
        success: false,
        error: `Security restriction: Cannot send gifts without a verified deal. This tool is only available during authorized trades. If you want to trade, propose a deal first using deal_propose.`,
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    // Get user entity
    const user = await gramJsClient.getEntity(userId);

    // Get payment form for the gift
    const invoiceData = {
      peer: user,
      giftId: BigInt(giftId),
      hideName: anonymous,
      message: message ? new Api.TextWithEntities({ text: message, entities: [] }) : undefined,
    };

    const form: any = await gramJsClient.invoke(
      new Api.payments.GetPaymentForm({
        invoice: new (Api as any).InputInvoiceStarGift(invoiceData),
      })
    );

    // Send the payment
    await gramJsClient.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice: new (Api as any).InputInvoiceStarGift(invoiceData),
      })
    );

    return {
      success: true,
      data: {
        recipient: userId,
        giftId,
        message,
        anonymous,
      },
    };
  } catch (error) {
    console.error("Error sending gift:", error);

    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("BALANCE_TOO_LOW")) {
      return {
        success: false,
        error: "Insufficient Stars balance to purchase this gift.",
      };
    }
    if (errorMsg.includes("STARGIFT_SOLDOUT")) {
      return {
        success: false,
        error: "This limited gift is sold out.",
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
