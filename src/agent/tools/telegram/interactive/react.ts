import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_react tool
 */
interface ReactParams {
  chatId: string;
  messageId: number;
  emoji: string;
}

/**
 * Tool definition for adding reactions to Telegram messages
 */
export const telegramReactTool: Tool = {
  name: "telegram_react",
  description:
    "Attach an emoji reaction to a message. Requires chatId and messageId. Use a single unicode emoji such as \ud83d\udc4d, \u2764\ufe0f, \ud83d\udd25, \ud83d\ude02, \ud83c\udf89, \ud83d\udc40, \ud83d\udcaf, or \ud83d\ude4f.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message is located",
    }),
    messageId: Type.Number({
      description:
        "The message ID to react to. Use the ID from incoming messages or from get_history results.",
    }),
    emoji: Type.String({
      description:
        "Single emoji to react with. Examples: '👍', '❤️', '🔥', '😂', '🎉', '👀', '💯', '🙏'",
    }),
  }),
};

/**
 * Executor for telegram_react tool
 */
export const telegramReactExecutor: ToolExecutor<ReactParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, emoji } = params;

    // Send reaction via Telegram bridge
    await context.bridge.sendReaction(chatId, messageId, emoji);

    return {
      success: true,
      data: {
        chatId,
        messageId,
        emoji,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error sending Telegram reaction");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
