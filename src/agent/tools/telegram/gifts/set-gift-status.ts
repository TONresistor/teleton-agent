import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import bigInt from "big-integer";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
  description: `Set a Collectible Gift as your Emoji Status (the icon next to your name).

USAGE:
- Set status: telegram_set_gift_status({ collectibleId: "123456789" })
- Clear status: telegram_set_gift_status({ clear: true })

IMPORTANT:
- Only COLLECTIBLE gifts (isCollectible: true) can be used as emoji status
- Use the "collectibleId" field from telegram_get_my_gifts (NOT the slug!)
- collectibleId is a numeric string like "6219780841349758977"

The emoji status appears next to your name in chats and your profile.`,
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
      // Clear the emoji status
      emojiStatus = new Api.EmojiStatusEmpty();
    } else {
      // Set collectible as emoji status
      emojiStatus = new Api.InputEmojiStatusCollectible({
        collectibleId: bigInt(collectibleId),
      });
    }

    // Update emoji status
    await gramJsClient.invoke(
      new Api.account.UpdateEmojiStatus({
        emojiStatus,
      })
    );

    const action = clear ? "cleared" : "set";
    console.log(
      `✨ Emoji status ${action}${collectibleId ? ` (collectible: ${collectibleId})` : ""}`
    );

    return {
      success: true,
      data: {
        action,
        collectibleId: clear ? null : collectibleId,
        message: clear ? "Emoji status cleared" : `Collectible gift set as your emoji status`,
      },
    };
  } catch (error) {
    console.error("Error setting gift status:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
