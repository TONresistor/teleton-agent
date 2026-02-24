import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Browse collectible gifts listed for resale. Filterable by gift type. Use telegram_buy_resale_gift to purchase.",
  category: "data-bearing",
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

    if (!(Api.payments as any).GetResaleStarGifts) {
      return {
        success: false,
        error:
          "Resale gift marketplace is not supported in the current Telegram API layer. A GramJS update is required.",
      };
    }

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
    log.error({ err: error }, "Error getting resale gifts");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
