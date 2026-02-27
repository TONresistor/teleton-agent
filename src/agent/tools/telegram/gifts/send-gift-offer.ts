import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { randomLong } from "../../../../utils/gramjs-bigint.js";

const log = createLogger("Tools");

interface SendGiftOfferParams {
  userId: string;
  slug: string;
  price: number;
  duration?: number;
}

export const telegramSendGiftOfferTool: Tool = {
  name: "telegram_send_gift_offer",
  description:
    "Send a buy offer on a unique collectible NFT gift to its owner. Specify price in Stars and optional duration (default 24h, minimum 6h).",
  parameters: Type.Object({
    userId: Type.String({
      description: "The owner's username (with or without @) or numeric user ID",
    }),
    slug: Type.String({
      description: "The NFT slug (from t.me/nft/<slug> or telegram_get_unique_gift)",
    }),
    price: Type.Number({
      description: "Offer price in Stars",
      minimum: 1,
    }),
    duration: Type.Optional(
      Type.Number({
        description: "Offer validity in seconds (default: 86400 = 24h, minimum: 21600 = 6h)",
        minimum: 21600,
      })
    ),
  }),
};

export const telegramSendGiftOfferExecutor: ToolExecutor<SendGiftOfferParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { userId, slug, price, duration = 86400 } = params;

    const gramJsClient = context.bridge.getClient().getClient();
    const peer = await gramJsClient.getInputEntity(userId);

    await gramJsClient.invoke(
      new Api.payments.SendStarGiftOffer({
        peer,
        slug,
        price: new Api.StarsAmount({ amount: BigInt(price) as any, nanos: 0 }),
        duration,
        randomId: randomLong(),
      })
    );

    log.info(`send_gift_offer: slug=${slug} price=${price} to=${userId}`);

    return {
      success: true,
      data: {
        slug,
        price,
        duration,
        durationHours: Math.round(duration / 3600),
        recipient: userId,
        message: `Offer of ${price} Stars sent for NFT ${slug}. Valid for ${Math.round(duration / 3600)}h.`,
      },
    };
  } catch (error: any) {
    const errorMsg = getErrorMessage(error);

    if (error.errorMessage === "BALANCE_TOO_LOW" || errorMsg.includes("BALANCE_TOO_LOW")) {
      return {
        success: false,
        error: "Insufficient Stars balance to make this offer.",
      };
    }

    if (error.errorMessage === "STARGIFT_SLUG_INVALID" || errorMsg.includes("STARGIFT_NOT_FOUND")) {
      return {
        success: false,
        error: `NFT not found: "${params.slug}". Check the slug.`,
      };
    }

    if (error.errorMessage === "PEER_ID_INVALID" || errorMsg.includes("PEER_ID_INVALID")) {
      return {
        success: false,
        error: `Could not find user "${params.userId}".`,
      };
    }

    log.error({ err: error }, "Error sending gift offer");
    return { success: false, error: errorMsg };
  }
};
