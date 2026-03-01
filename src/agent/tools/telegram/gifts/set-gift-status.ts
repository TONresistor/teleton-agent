import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for setting a collectible gift as emoji status
 */
interface SetGiftStatusParams {
  collectibleId?: string;
  clear?: boolean;
}

/**
 * Tool definition for setting collectible gift as emoji status
 */
export const telegramSetGiftStatusTool: Tool = {
  name: "telegram_set_gift_status",
  description:
    "Set a collectible gift as your emoji status (icon next to your name). Use collectibleId from telegram_get_my_gifts (not slug). Set clear=true to remove.",
  parameters: Type.Object({
    collectibleId: Type.Optional(
      Type.String({
        description: "The collectible ID of the gift to set as status",
      })
    ),
    clear: Type.Optional(
      Type.Boolean({
        description: "Set to true to clear/remove the emoji status",
      })
    ),
  }),
};

/**
 * Executor for telegram_set_gift_status tool
 */
export const telegramSetGiftStatusExecutor: ToolExecutor<SetGiftStatusParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { collectibleId, clear = false } = params;
    const gramJsClient = context.bridge.getClient().getClient();

    let emojiStatus: Api.TypeEmojiStatus;

    if (clear || !collectibleId) {
      emojiStatus = new Api.EmojiStatusEmpty();
    } else {
      emojiStatus = new Api.InputEmojiStatusCollectible({
        collectibleId: BigInt(collectibleId) as any,
      });
    }

    await gramJsClient.invoke(
      new Api.account.UpdateEmojiStatus({
        emojiStatus,
      })
    );

    const action = clear ? "cleared" : "set";
    log.info(`Emoji status ${action}${collectibleId ? ` (collectible: ${collectibleId})` : ""}`);

    return {
      success: true,
      data: {
        action,
        collectibleId: clear ? null : collectibleId,
        message: clear ? "Emoji status cleared" : `Collectible gift set as your emoji status`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error setting gift status");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
