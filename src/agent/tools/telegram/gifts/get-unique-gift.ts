import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { readStarsAmount } from "../../../../utils/gramjs-bigint.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

interface GetUniqueGiftParams {
  slug: string;
}

export const telegramGetUniqueGiftTool: Tool = {
  name: "telegram_get_unique_gift",
  description:
    "Look up a unique collectible NFT gift by its slug (from t.me/nft/<slug>). Returns its owner, attributes, availability, resale prices, and on-chain sale details.",
  category: "data-bearing",
  parameters: Type.Object({
    slug: Type.String({
      description: "NFT slug from the t.me/nft/<slug> URL",
    }),
  }),
};

export const telegramGetUniqueGiftExecutor: ToolExecutor<GetUniqueGiftParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { slug } = params;
    const gramJsClient = getClient(context.bridge);

    const result = await gramJsClient.invoke(new Api.payments.GetUniqueStarGift({ slug }));

    const gift = result.gift;

    if (gift.className !== "StarGiftUnique") {
      return { success: false, error: "Gift is not a unique collectible" };
    }

    const ownerUserId =
      gift.ownerId && "userId" in gift.ownerId ? gift.ownerId.userId?.toString() : undefined;
    const ownerUser = (result.users || []).find(
      (user): user is Api.User => user.className === "User" && user.id?.toString() === ownerUserId
    );

    log.info(`get_unique_gift: slug=${slug} title=${gift.title}`);

    return {
      success: true,
      data: {
        id: gift.id?.toString(),
        giftId: gift.giftId?.toString(),
        slug: gift.slug,
        title: gift.title,
        num: gift.num,
        owner: {
          id: ownerUserId,
          name: gift.ownerName || undefined,
          address: gift.ownerAddress || undefined,
          username: ownerUser?.username || undefined,
          firstName: ownerUser?.firstName || undefined,
          lastName: ownerUser?.lastName || undefined,
        },
        giftAddress: gift.giftAddress || undefined,
        attributes: (gift.attributes || []).map((attr) => ({
          type: attr.className?.replace("StarGiftAttribute", "").toLowerCase(),
          name: "name" in attr ? attr.name : undefined,
          rarityPercent:
            "rarity" in attr && "permille" in attr.rarity ? attr.rarity.permille / 10 : undefined,
        })),
        resellPrices: (gift.resellAmount || [])
          .map(readStarsAmount)
          .filter((price) => price !== undefined),
        onchainSale: gift.onchainSale ?? false,
        fixedSale: gift.fixedSale ?? false,
        mySale: gift.mySale ?? false,
        offerMinAmount: gift.offerMinAmount?.toString(),
        feeBps: gift.feeBps,
        availability: gift.availabilityIssued
          ? {
              total: gift.availabilityTotal,
              remaining: gift.availabilityTotal - gift.availabilityIssued,
            }
          : undefined,
        nftLink: `t.me/nft/${gift.slug}`,
      },
    };
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    if (errMsg.includes("STARGIFT_SLUG_INVALID")) {
      return {
        success: false,
        error: `Invalid NFT slug "${params.slug}". Check the slug from t.me/nft/<slug>.`,
      };
    }
    log.error({ err: error }, "Error getting unique gift");
    return { success: false, error: errMsg };
  }
};
