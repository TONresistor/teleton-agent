import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for getting available gifts
 */
interface GetAvailableGiftsParams {
  filter?: "all" | "limited" | "unlimited" | "resale";
  includeSoldOut?: boolean;
  limit?: number;
  offset?: number;
  sort?: "price_asc" | "price_desc" | "resale_count" | "resale_min_price";
  search?: string;
}

/**
 * Tool definition for getting available Star Gifts
 */
export const telegramGetAvailableGiftsTool: Tool = {
  name: "telegram_get_available_gifts",
  description:
    "Browse the Star Gift catalog. Use filter='resale' to see collections with active marketplace listings. Returns collection IDs for use with telegram_get_resale_gifts and telegram_send_gift.",
  category: "data-bearing",
  parameters: Type.Object({
    filter: Type.Optional(
      Type.Union(
        [
          Type.Literal("all"),
          Type.Literal("limited"),
          Type.Literal("unlimited"),
          Type.Literal("resale"),
        ],
        {
          description:
            "Filter: 'all' (default), 'limited' (rare), 'unlimited' (always available), 'resale' (collections with active resale listings)",
        }
      )
    ),
    includeSoldOut: Type.Optional(
      Type.Boolean({
        description:
          "Include sold-out gifts. Default: true (most gifts sell out in minutes, so excluding them hides almost everything).",
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Max results to return (default: 20). Use with offset for pagination.",
        minimum: 1,
        maximum: 100,
      })
    ),
    offset: Type.Optional(
      Type.Number({
        description: "Skip this many results (for pagination). Default: 0",
        minimum: 0,
      })
    ),
    sort: Type.Optional(
      Type.Union(
        [
          Type.Literal("price_asc"),
          Type.Literal("price_desc"),
          Type.Literal("resale_count"),
          Type.Literal("resale_min_price"),
        ],
        {
          description:
            "Sort by: 'price_asc' (cheapest first), 'price_desc' (most expensive), 'resale_count' (most listings), 'resale_min_price' (cheapest resale). Default: no sort",
        }
      )
    ),
    search: Type.Optional(
      Type.String({
        description: "Search collections by title (case-insensitive). E.g. 'pepe', 'heart'",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_available_gifts tool
 */
export const telegramGetAvailableGiftsExecutor: ToolExecutor<GetAvailableGiftsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { filter = "all", includeSoldOut = true, limit = 20, offset = 0, sort, search } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const result: any = await gramJsClient.invoke(new Api.payments.GetStarGifts({ hash: 0 }));

    if (result.className === "payments.StarGiftsNotModified") {
      return {
        success: true,
        data: { gifts: [], message: "Gift catalog not modified since last check" },
      };
    }

    // Map all gifts
    let gifts = (result.gifts || []).map((gift: any) => ({
      id: gift.id?.toString(),
      title: gift.title || null,
      stars: Number(gift.stars?.toString() || "0"),
      limited: gift.limited || false,
      soldOut: gift.soldOut || false,
      availabilityRemains: gift.limited ? gift.availabilityRemains?.toString() : undefined,
      availabilityTotal: gift.limited ? gift.availabilityTotal?.toString() : undefined,
      convertStars: Number(gift.convertStars?.toString() || "0"),
      upgradeStars: gift.upgradeStars ? Number(gift.upgradeStars.toString()) : undefined,
      resaleCount: gift.availabilityResale ? Number(gift.availabilityResale.toString()) : 0,
      resaleMinPrice: gift.resellMinStars ? Number(gift.resellMinStars.toString()) : undefined,
    }));

    // Filter
    if (filter === "limited") {
      gifts = gifts.filter((g: any) => g.limited);
    } else if (filter === "unlimited") {
      gifts = gifts.filter((g: any) => !g.limited);
    } else if (filter === "resale") {
      gifts = gifts.filter((g: any) => g.resaleCount > 0);
    }

    // soldOut = no fresh stock (mints sell out in ~1 min). Only filter if explicitly requested.
    if (includeSoldOut === false && filter !== "resale" && !search) {
      gifts = gifts.filter((g: any) => !g.soldOut);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      gifts = gifts.filter((g: any) => g.title?.toLowerCase().includes(q));
    }

    const totalFiltered = gifts.length;

    // Sort
    if (sort === "price_asc") {
      gifts.sort((a: any, b: any) => a.stars - b.stars);
    } else if (sort === "price_desc") {
      gifts.sort((a: any, b: any) => b.stars - a.stars);
    } else if (sort === "resale_count") {
      gifts.sort((a: any, b: any) => b.resaleCount - a.resaleCount);
    } else if (sort === "resale_min_price") {
      gifts = gifts.filter((g: any) => g.resaleMinPrice != null);
      gifts.sort((a: any, b: any) => a.resaleMinPrice - b.resaleMinPrice);
    }

    // Paginate
    const page = gifts.slice(offset, offset + limit);

    return {
      success: true,
      data: {
        gifts: page,
        pagination: {
          total: totalFiltered,
          offset,
          limit,
          returned: page.length,
          hasMore: offset + limit < totalFiltered,
        },
        usage:
          "Use gift 'id' with telegram_get_resale_gifts(giftId) to browse resale listings, or telegram_send_gift(userId, giftId) to send.",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting available gifts");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
