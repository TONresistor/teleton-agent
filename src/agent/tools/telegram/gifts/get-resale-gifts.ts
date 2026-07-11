/* eslint-disable @typescript-eslint/no-explicit-any */
import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { toLong } from "../../../../utils/gramjs-bigint.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

/**
 * Parameters for getting resale gifts
 */
interface GetResaleGiftsParams {
  giftId: string;
  limit?: number;
  sortByPrice?: boolean;
}

/**
 * Tool definition for getting resale marketplace
 */
export const telegramGetResaleGiftsTool: Tool = {
  name: "telegram_get_resale_gifts",
  description:
    "Browse collectible gifts listed for resale from a specific collection. Each collection (e.g. 'Pepe Plush') has a numeric ID — pass it as giftId. Get collection IDs from telegram_get_available_gifts. Returns individual listings with slugs for purchasing.",
  category: "data-bearing",
  parameters: Type.Object({
    giftId: Type.String({
      description:
        "The numeric collection ID (base gift type ID) to browse resale listings for. Get it from telegram_get_available_gifts.",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum results to return (default: 30)",
        minimum: 1,
        maximum: 100,
      })
    ),
    sortByPrice: Type.Optional(
      Type.Boolean({
        description: "Sort by price (lowest first). Default: false (sorted by recent)",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_resale_gifts tool
 */
export const telegramGetResaleGiftsExecutor: ToolExecutor<GetResaleGiftsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { giftId, limit = 30, sortByPrice = false } = params;
    const gramJsClient = getClient(context.bridge);

    if (!/^\d+$/.test(giftId)) {
      return {
        success: false,
        error:
          "giftId must be a numeric collection ID (e.g. '5170'). Use telegram_get_available_gifts to find collection IDs.",
      };
    }

    const result = await gramJsClient.invoke(
      new Api.payments.GetResaleStarGifts({
        giftId: toLong(giftId),
        offset: "",
        limit,
        sortByPrice,
      })
    );

    const listings = (result.gifts || []).map((gift: any) => {
      if (gift.className === "StarGiftUnique") {
        // StarGiftUnique: individual collectible with slug, num, owner, attributes
        const resellAmounts = gift.resellAmount || [];
        const starsPrice = resellAmounts.find((a: any) => !("ton" in a));
        const tonPrice = resellAmounts.find((a: any) => "ton" in a);

        return {
          type: "unique" as const,
          id: gift.id?.toString(),
          giftId: gift.giftId?.toString(),
          slug: gift.slug,
          title: gift.title,
          num: gift.num,
          ownerId:
            gift.ownerId && "userId" in gift.ownerId ? gift.ownerId.userId?.toString() : undefined,
          ownerName: gift.ownerName || undefined,
          priceStars: starsPrice ? starsPrice.amount?.toString() : undefined,
          priceTon: tonPrice ? tonPrice.amount?.toString() : undefined,
          attributes: (gift.attributes || []).map((attr: any) => ({
            type: attr.className?.replace("StarGiftAttribute", "").toLowerCase(),
            name: "name" in attr ? attr.name : undefined,
          })),
        };
      }

      // StarGift: collection template (fallback — shouldn't normally appear in resale)
      return {
        type: "collection" as const,
        id: gift.id?.toString(),
        title: gift.title,
        stars: Number(gift.stars?.toString() || "0"),
        limited: gift.limited || false,
        soldOut: gift.soldOut || false,
        resaleCount: gift.availabilityResale ? Number(gift.availabilityResale.toString()) : 0,
        resaleMinPrice: gift.resellMinStars ? Number(gift.resellMinStars.toString()) : undefined,
      };
    });

    return {
      success: true,
      data: {
        giftId,
        listings,
        count: listings.length,
        totalCount: result.count,
        usage:
          "Use telegram_buy_resale_gift(slug, maxPriceStars) with the listing's priceStars as the owner-approved maximum.",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting resale gifts");

    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes("STARGIFT_INVALID")) {
      return {
        success: false,
        error: `Collection ID '${params.giftId}' is invalid or has no resale listings. Use telegram_get_available_gifts to find valid collection IDs.`,
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
