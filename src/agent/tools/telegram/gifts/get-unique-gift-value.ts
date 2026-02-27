import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface GetUniqueGiftValueParams {
  slug: string;
}

export const telegramGetUniqueGiftValueTool: Tool = {
  name: "telegram_get_unique_gift_value",
  description:
    "Get market valuation data for a unique collectible NFT gift. Returns sale history, floor price, average price, and Fragment listing info.",
  category: "data-bearing",
  parameters: Type.Object({
    slug: Type.String({
      description: "The NFT slug (from t.me/nft/<slug>)",
    }),
  }),
};

export const telegramGetUniqueGiftValueExecutor: ToolExecutor<GetUniqueGiftValueParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { slug } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    log.info(`get_unique_gift_value: slug=${slug}`);

    const result: any = await gramJsClient.invoke(
      new Api.payments.GetUniqueStarGiftValueInfo({ slug })
    );

    return {
      success: true,
      data: {
        slug,
        initialSaleDate: result.initialSaleDate
          ? new Date(result.initialSaleDate * 1000).toISOString()
          : undefined,
        initialSaleStars: result.initialSaleStars?.toString(),
        initialSalePrice: result.initialSalePrice?.toString(),
        lastSaleDate: result.lastSaleDate
          ? new Date(result.lastSaleDate * 1000).toISOString()
          : undefined,
        lastSalePrice: result.lastSalePrice?.toString(),
        floorPrice: result.floorPrice?.toString(),
        averagePrice: result.averagePrice?.toString(),
        listedCount: result.listedCount,
        fragmentListedCount: result.fragmentListedCount,
        fragmentListedUrl: result.fragmentListedUrl || undefined,
        currency: result.currency,
        value: result.value?.toString(),
      },
    };
  } catch (error: any) {
    if (error.errorMessage === "STARGIFT_SLUG_INVALID") {
      return {
        success: false,
        error: `Invalid NFT slug "${params.slug}". Check the slug from t.me/nft/<slug>.`,
      };
    }
    log.error({ err: error }, "Error getting unique gift value");
    return { success: false, error: getErrorMessage(error) };
  }
};
