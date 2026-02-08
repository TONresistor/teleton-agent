import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
  description: `Get Star Gifts you or another user has received.

USAGE:
- To view YOUR OWN gifts: omit both userId and viewSender
- To view the SENDER's gifts (when user says "show me MY gifts"): set viewSender=true
- To view a specific user's gifts: pass their userId

PRESENTATION GUIDE:
- For collectibles: Use "title + model" as display name (e.g., "Hypno Lollipop Telegram")
- NFT link: t.me/nft/{slug} (e.g., t.me/nft/HypnoLollipop-63414)
- Respond concisely: "You have a Hypno Lollipop Telegram 🍭"
- Only give details (rarity, backdrop, pattern) when specifically asked
- attributes.model.name = model, attributes.pattern.name = pattern, attributes.backdrop.name = backdrop
- rarityPermille: divide by 10 to get percentage (7 = 0.7%)

TRANSFER: Use msgId (for your own gifts) to transfer collectibles via telegram_transfer_collectible.

NEVER dump all raw data. Keep responses natural and concise.`,
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

    // Determine whose gifts to view:
    // 1. viewSender=true -> use context.senderId (the person who sent the message)
    // 2. userId provided -> use that specific user
    // 3. neither -> view agent's own gifts
    const targetUserId = viewSender ? context.senderId.toString() : userId;

    // Get peer (self or specified user)
    const peer = targetUserId
      ? await gramJsClient.getEntity(targetUserId)
      : new Api.InputPeerSelf();

    // Get catalog to enrich gift info (cached with TTL + incremental hash)
    let catalogMap: Map<string, any>;
    if (giftCatalogCache && Date.now() < giftCatalogCache.expiresAt) {
      catalogMap = giftCatalogCache.map;
    } else {
      const prevHash = giftCatalogCache?.hash ?? 0;
      const catalog: any = await gramJsClient.invoke(
        new Api.payments.GetStarGifts({ hash: prevHash })
      );

      if (catalog.gifts && catalog.gifts.length > 0) {
        // New or updated catalog
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
        // Hash unchanged or empty response — reuse cached map
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

      // For collectibles, use giftId to lookup original type
      const lookupId = isCollectible ? gift.giftId?.toString() : gift.id?.toString();
      const catalogInfo = catalogMap.get(lookupId);

      // A gift is limited if it's a collectible OR catalog says it's limited
      const isLimited = isCollectible || catalogInfo?.limited === true;

      // Extract only essential attribute info to reduce response size
      const extractAttrSummary = (attr: any) =>
        attr
          ? {
              name: attr.name,
              rarityPercent: attr.rarityPermille
                ? (attr.rarityPermille / 10).toFixed(1) + "%"
                : null,
            }
          : null;

      // Build compact gift object
      const compactGift: Record<string, any> = {
        date: savedGift.date,
        isLimited,
        isCollectible,
        stars: gift?.stars?.toString(),
        emoji: catalogInfo?.emoji || null,
        // IDs needed for transfer/actions (msgId for user gifts, savedId for chat gifts)
        msgId: savedGift.msgId,
        savedId: savedGift.savedId?.toString(),
        // Transfer cost in Stars (if set, transfer requires payment; if null, transfer is free)
        transferStars: savedGift.transferStars?.toString() || null,
      };

      // Add collectible-specific fields only if it's a collectible
      if (isCollectible) {
        compactGift.collectibleId = gift.id?.toString(); // Used for emoji status
        compactGift.title = gift.title;
        compactGift.num = gift.num;
        compactGift.slug = gift.slug;
        compactGift.nftLink = `t.me/nft/${gift.slug}`;
        // Compact attribute summary
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
        // Non-collectible: add upgrade info
        compactGift.canUpgrade = savedGift.canUpgrade || false;
        if (savedGift.canUpgrade) {
          compactGift.upgradeStars = gift?.upgradeStars?.toString();
        }
      }

      // Add limited edition info if applicable
      if (isLimited && !isCollectible) {
        compactGift.availabilityRemains =
          catalogInfo?.availabilityRemains || gift?.availabilityRemains;
        compactGift.availabilityTotal = catalogInfo?.availabilityTotal || gift?.availabilityTotal;
      }

      return compactGift;
    });

    // Categorize gifts
    const limited = gifts.filter((g: any) => g.isLimited);
    const unlimited = gifts.filter((g: any) => !g.isLimited);
    const collectibles = gifts.filter((g: any) => g.isCollectible);

    // Log for debugging
    const viewingLabel = viewSender ? `sender (${context.senderId})` : userId || "self";
    console.log(
      `📦 get_my_gifts: viewing ${viewingLabel}, found ${gifts.length} gifts (${collectibles.length} collectibles)`
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
    console.error("Error getting gifts:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
