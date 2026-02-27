import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Gift catalog cache (module-level, shared across calls)
 */
let giftCatalogCache: { map: Map<string, any>; hash: number; expiresAt: number } | null = null;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extract emoji from sticker document
 */
function extractEmoji(sticker: any): string | null {
  if (!sticker?.attributes) return null;

  const attr = sticker.attributes.find(
    (a: any) =>
      a.className === "DocumentAttributeSticker" || a.className === "DocumentAttributeCustomEmoji"
  );

  return attr?.alt || null;
}

/**
 * Parameters for getting my gifts
 */
interface GetMyGiftsParams {
  userId?: string;
  viewSender?: boolean;
  limit?: number;
  excludeUnsaved?: boolean;
  excludeSaved?: boolean;
  sortByValue?: boolean;
}

/**
 * Tool definition for getting received gifts
 */
export const telegramGetMyGiftsTool: Tool = {
  name: "telegram_get_my_gifts",
  description:
    "Get Star Gifts received by you or another user. Set viewSender=true when sender says 'show MY gifts'. For collectibles: display as 'title + model', link as t.me/nft/{slug}. rarityPermille / 10 = %. Use msgId for transfers.",
  parameters: Type.Object({
    userId: Type.Optional(
      Type.String({
        description:
          "User ID to get gifts for. Use viewSender=true instead if looking at the message sender's gifts.",
      })
    ),
    viewSender: Type.Optional(
      Type.Boolean({
        description:
          "Set to true to view the message sender's gifts (when user says 'show me MY gifts'). Takes precedence over userId.",
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of gifts to return (default: 50)",
        minimum: 1,
        maximum: 200,
      })
    ),
    excludeUnsaved: Type.Optional(
      Type.Boolean({
        description: "Only show gifts saved/displayed on profile",
      })
    ),
    excludeSaved: Type.Optional(
      Type.Boolean({
        description: "Only show gifts NOT displayed on profile",
      })
    ),
    sortByValue: Type.Optional(
      Type.Boolean({
        description: "Sort by value instead of date. Default: false (sorted by date)",
      })
    ),
  }),
  category: "data-bearing",
};

/**
 * Executor for telegram_get_my_gifts tool
 */
export const telegramGetMyGiftsExecutor: ToolExecutor<GetMyGiftsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      userId,
      viewSender,
      limit = 50,
      excludeUnsaved,
      excludeSaved,
      sortByValue = false,
    } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const targetUserId = viewSender ? context.senderId.toString() : userId;

    const peer = targetUserId
      ? await gramJsClient.getEntity(targetUserId)
      : new Api.InputPeerSelf();

    let catalogMap: Map<string, any>;
    if (giftCatalogCache && Date.now() < giftCatalogCache.expiresAt) {
      catalogMap = giftCatalogCache.map;
    } else {
      const prevHash = giftCatalogCache?.hash ?? 0;
      const catalog: any = await gramJsClient.invoke(
        new Api.payments.GetStarGifts({ hash: prevHash })
      );

      if (catalog.gifts && catalog.gifts.length > 0) {
        catalogMap = new Map();
        for (const catalogGift of catalog.gifts) {
          const id = catalogGift.id?.toString();
          if (id) {
            catalogMap.set(id, {
              limited: catalogGift.limited || false,
              soldOut: catalogGift.soldOut || false,
              emoji: extractEmoji(catalogGift.sticker),
              availabilityTotal: catalogGift.availabilityTotal,
              availabilityRemains: catalogGift.availabilityRemains,
            });
          }
        }
        giftCatalogCache = {
          map: catalogMap,
          hash: catalog.hash ?? 0,
          expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
        };
      } else {
        catalogMap = giftCatalogCache?.map ?? new Map();
        giftCatalogCache = {
          map: catalogMap,
          hash: catalog.hash ?? giftCatalogCache?.hash ?? 0,
          expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
        };
      }
    }

    const result: any = await gramJsClient.invoke(
      new Api.payments.GetSavedStarGifts({
        peer,
        offset: "",
        limit,
        excludeUnsaved,
        excludeSaved,
        sortByValue,
      })
    );

    const gifts = (result.gifts || []).map((savedGift: any) => {
      const gift = savedGift.gift;
      const isCollectible = gift?.className === "StarGiftUnique";

      const lookupId = isCollectible ? gift.giftId?.toString() : gift.id?.toString();
      const catalogInfo = catalogMap.get(lookupId);

      const isLimited = isCollectible || catalogInfo?.limited === true;

      const extractAttrSummary = (attr: any) =>
        attr
          ? {
              name: attr.name,
              rarityPercent: attr.rarityPermille
                ? (attr.rarityPermille / 10).toFixed(1) + "%"
                : null,
            }
          : null;

      const compactGift: Record<string, any> = {
        date: savedGift.date,
        isLimited,
        isCollectible,
        stars: gift?.stars?.toString(),
        emoji: catalogInfo?.emoji || null,
        msgId: savedGift.msgId,
        savedId: savedGift.savedId?.toString(),
        transferStars: savedGift.transferStars?.toString() || null,
      };

      if (isCollectible) {
        compactGift.collectibleId = gift.id?.toString(); // Used for emoji status
        compactGift.title = gift.title;
        compactGift.num = gift.num;
        compactGift.slug = gift.slug;
        compactGift.nftLink = `t.me/nft/${gift.slug}`;
        const modelAttr = gift.attributes?.find(
          (a: any) => a.className === "StarGiftAttributeModel"
        );
        const patternAttr = gift.attributes?.find(
          (a: any) => a.className === "StarGiftAttributePattern"
        );
        const backdropAttr = gift.attributes?.find(
          (a: any) => a.className === "StarGiftAttributeBackdrop"
        );
        compactGift.model = extractAttrSummary(modelAttr);
        compactGift.pattern = extractAttrSummary(patternAttr);
        compactGift.backdrop = extractAttrSummary(backdropAttr);
      } else {
        compactGift.canUpgrade = savedGift.canUpgrade || false;
        if (savedGift.canUpgrade) {
          compactGift.upgradeStars = gift?.upgradeStars?.toString();
        }
      }

      if (isLimited && !isCollectible) {
        compactGift.availabilityRemains =
          catalogInfo?.availabilityRemains || gift?.availabilityRemains;
        compactGift.availabilityTotal = catalogInfo?.availabilityTotal || gift?.availabilityTotal;
      }

      return compactGift;
    });

    const limited = gifts.filter((g: any) => g.isLimited);
    const unlimited = gifts.filter((g: any) => !g.isLimited);
    const collectibles = gifts.filter((g: any) => g.isCollectible);

    const viewingLabel = viewSender ? `sender (${context.senderId})` : userId || "self";
    log.info(
      `get_my_gifts: viewing ${viewingLabel}, found ${gifts.length} gifts (${collectibles.length} collectibles)`
    );

    return {
      success: true,
      data: {
        viewingUser: targetUserId || "self",
        gifts,
        summary: {
          total: gifts.length,
          limited: limited.length,
          unlimited: unlimited.length,
          collectibles: collectibles.length,
          canUpgrade: gifts.filter((g: any) => g.canUpgrade).length,
        },
        totalCount: result.count,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting gifts");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
