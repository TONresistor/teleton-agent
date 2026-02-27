import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for resolving a gift offer
 */
interface ResolveGiftOfferParams {
  offerMsgId: number;
  decline?: boolean;
}

/**
 * Tool definition for resolving a gift offer
 */
export const telegramResolveGiftOfferTool: Tool = {
  name: "telegram_resolve_gift_offer",
  description:
    "Accept or decline a received buy offer on one of your collectible NFT gifts. The offer message ID is found in Saved Messages.",
  parameters: Type.Object({
    offerMsgId: Type.Number({
      description: "The message ID of the offer in your Saved Messages",
    }),
    decline: Type.Optional(
      Type.Boolean({
        description: "Set to true to decline the offer. Omit or false to accept.",
      })
    ),
  }),
};

/**
 * Executor for telegram_resolve_gift_offer tool
 */
export const telegramResolveGiftOfferExecutor: ToolExecutor<ResolveGiftOfferParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { offerMsgId, decline } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const invokeParams: any = { offerMsgId };
    if (decline) {
      invokeParams.decline = true;
    }

    await gramJsClient.invoke(new Api.payments.ResolveStarGiftOffer(invokeParams));

    const action = decline ? "declined" : "accepted";
    log.info(`resolve_gift_offer: msgId=${offerMsgId} action=${action}`);

    return {
      success: true,
      data: {
        offerMsgId,
        action,
        message: `Offer ${action} successfully.`,
      },
    };
  } catch (error: any) {
    const errorMsg = getErrorMessage(error);

    if (error.errorMessage === "STARGIFT_NOT_FOUND" || errorMsg.includes("STARGIFT_NOT_FOUND")) {
      return {
        success: false,
        error: "Offer not found. It may have expired or already been resolved.",
      };
    }

    log.error({ err: error }, "Error resolving gift offer");
    return { success: false, error: errorMsg };
  }
};
