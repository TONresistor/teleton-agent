import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface GetCollectibleInfoParams {
  type: "username" | "phone";
  value: string;
}

export const telegramGetCollectibleInfoTool: Tool = {
  name: "telegram_get_collectible_info",
  description:
    "Get info about a Fragment collectible (username or phone number). Returns purchase date, price (fiat + crypto), and Fragment URL.",
  category: "data-bearing",
  parameters: Type.Object({
    type: Type.Union([Type.Literal("username"), Type.Literal("phone")], {
      description:
        "Type of collectible: 'username' for a Telegram username, 'phone' for a phone number",
    }),
    value: Type.String({
      description: "The username (without @) or phone number (with country code, e.g. +888...)",
    }),
  }),
};

export const telegramGetCollectibleInfoExecutor: ToolExecutor<GetCollectibleInfoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { type, value } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    const collectible =
      type === "username"
        ? new Api.InputCollectibleUsername({ username: value.replace("@", "") })
        : new Api.InputCollectiblePhone({ phone: value });

    const result = await gramJsClient.invoke(new Api.fragment.GetCollectibleInfo({ collectible }));

    log.info(`💎 get_collectible_info: ${type}=${value}`);

    return {
      success: true,
      data: {
        type,
        value,
        purchaseDate: new Date(result.purchaseDate * 1000).toISOString(),
        currency: result.currency,
        amount: result.amount?.toString(),
        cryptoCurrency: result.cryptoCurrency,
        cryptoAmount: result.cryptoAmount?.toString(),
        url: result.url,
      },
    };
  } catch (error: any) {
    if (
      error.errorMessage === "PHONE_NOT_OCCUPIED" ||
      error.errorMessage === "USERNAME_NOT_OCCUPIED"
    ) {
      return {
        success: false,
        error: `Collectible not found: ${params.type} "${params.value}" is not a Fragment collectible.`,
      };
    }

    log.error({ err: error }, "Error getting collectible info");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
