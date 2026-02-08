import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for getting resale gifts
 */
interface GetResaleGiftsParams {
  giftId?: string;
  limit?: number;
  sortByPrice?: boolean;
}

/**
 * Tool definition for getting resale marketplace
 */
export const telegramGetResaleGiftsTool: Tool = {
  name: "telegram_get_resale_gifts",
  description:
    "Browse the collectible gifts marketplace. Shows all collectibles currently listed for sale by other users. Can filter by specific gift type or browse all. Returns prices in Stars and seller info. Use telegram_buy_resale_gift to purchase.",
  parameters: Type.Object({
    giftId: Type.Optional(
      Type.String({
        description: "Filter by specific gift type ID. Omit to see all types.",
      })
    ),
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
    const gramJsClient = context.bridge.getClient().getClient();

    const result: any = await gramJsClient.invoke(
      new (Api.payments as any).GetResaleStarGifts({
        giftId: giftId ? BigInt(giftId) : undefined,
        offset: "",
        limit,
        sortByPrice,
      })
    );

    const listings = (result.gifts || []).map((listing: any) => {
      const gift = listing.gift;

      return {
        // Listing info
        odayId: listing.odayId?.toString(),
        price: listing.resellStars?.toString(),
        date: listing.date,

        // Gift info
        slug: gift?.slug,
        title: gift?.title,
        num: gift?.num,
        ownerId: gift?.ownerId?.userId?.toString(),

        // For buying
        inputGift: {
          odayId: listing.odayId?.toString(),
        },
      };
    });

    return {
      success: true,
      data: {
        listings,
        count: listings.length,
        totalCount: result.count,
        usage: "Use telegram_buy_resale_gift(odayId) to purchase",
      },
    };
  } catch (error) {
    console.error("Error getting resale gifts:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
