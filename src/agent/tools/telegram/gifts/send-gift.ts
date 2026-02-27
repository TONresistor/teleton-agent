import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { hasVerifiedDeal } from "../../../../deals/module.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Send a Star Gift to a user. Costs Stars. Requires a verified deal (use deal_propose first).",
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

    if (!hasVerifiedDeal(giftId, userId)) {
      return {
        success: false,
        error: `Security restriction: Cannot send gifts without a verified deal. This tool is only available during authorized trades. If you want to trade, propose a deal first using deal_propose.`,
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    const user = await gramJsClient.getInputEntity(userId);

    const invoiceData = {
      peer: user,
      giftId: BigInt(giftId) as any,
      hideName: anonymous,
      message: message ? new Api.TextWithEntities({ text: message, entities: [] }) : undefined,
    };

    const form: any = await gramJsClient.invoke(
      new Api.payments.GetPaymentForm({
        invoice: new Api.InputInvoiceStarGift(invoiceData),
      })
    );

    await gramJsClient.invoke(
      new Api.payments.SendStarsForm({
        formId: form.formId,
        invoice: new Api.InputInvoiceStarGift(invoiceData),
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
    log.error({ err: error }, "Error sending gift");

    const errorMsg = getErrorMessage(error);
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
