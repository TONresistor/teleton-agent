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
  filter?: "all" | "limited" | "unlimited";
  includesSoldOut?: boolean;
}

/**
 * Tool definition for getting available Star Gifts
 */
export const telegramGetAvailableGiftsTool: Tool = {
  name: "telegram_get_available_gifts",
  description:
    "Get Star Gifts available for purchase. Filterable by limited/unlimited. Use gift ID with telegram_send_gift.",
  category: "data-bearing",
  parameters: Type.Object({
    filter: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("limited"), Type.Literal("unlimited")], {
        description:
          "Filter gifts: 'all' (default), 'limited' (rare/collectible), 'unlimited' (always available)",
      })
    ),
    includesSoldOut: Type.Optional(
      Type.Boolean({
        description: "Include sold-out limited gifts in results. Default: false",
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
    const { filter = "all", includesSoldOut = false } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const result: any = await gramJsClient.invoke(
      new Api.payments.GetStarGifts({
        hash: 0,
      })
    );

    if (result.className === "payments.StarGiftsNotModified") {
      return {
        success: true,
        data: {
          gifts: [],
          message: "Gift catalog not modified since last check",
        },
      };
    }

    let gifts = (result.gifts || []).map((gift: any) => {
      const isLimited = gift.limited || false;
      const soldOut = gift.soldOut || false;
      const availabilityRemains = gift.availabilityRemains?.toString();
      const availabilityTotal = gift.availabilityTotal?.toString();

      return {
        id: gift.id?.toString(),
        stars: gift.stars?.toString(),
        isLimited,
        soldOut,
        availabilityRemains: isLimited ? availabilityRemains : "unlimited",
        availabilityTotal: isLimited ? availabilityTotal : "unlimited",
        convertStars: gift.convertStars?.toString(), // Stars received if converted
        firstSaleDate: gift.firstSaleDate,
        lastSaleDate: gift.lastSaleDate,
        upgradeStars: gift.upgradeStars?.toString(), // Cost to upgrade to collectible
      };
    });

    if (filter === "limited") {
      gifts = gifts.filter((g: any) => g.isLimited);
    } else if (filter === "unlimited") {
      gifts = gifts.filter((g: any) => !g.isLimited);
    }

    if (!includesSoldOut) {
      gifts = gifts.filter((g: any) => !g.soldOut);
    }

    const limited = gifts.filter((g: any) => g.isLimited);
    const unlimited = gifts.filter((g: any) => !g.isLimited);

    return {
      success: true,
      data: {
        gifts,
        summary: {
          total: gifts.length,
          limited: limited.length,
          unlimited: unlimited.length,
          soldOut: result.gifts?.filter((g: any) => g.soldOut).length || 0,
        },
        usage: "Use telegram_send_gift(userId, giftId) to send a gift",
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
