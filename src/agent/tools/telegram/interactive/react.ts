import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_react tool
 */
interface ReactParams {
  chatId: string | number;
  messageId: number;
  emoji: string;
}

/**
 * Tool definition for adding reactions to Telegram messages
 */
export const telegramReactTool: Tool = {
  name: "telegram_react",
  description:
    "Attach an emoji reaction to a message. Requires chatId and messageId. Use a single unicode emoji such as \ud83d\udc4d, \u2764\ufe0f, \ud83d\udd25, \ud83d\ude02, \ud83c\udf89, \ud83d\udc40, \ud83d\udcaf, or \ud83d\ude4f. Only call this when the user explicitly asks to react \u2014 do not react proactively.",
  parameters: Type.Object({
    chatId: Type.Union([Type.String(), Type.Number()]),
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

telegramReactTool.description =
  "Attach one emoji reaction to a message. Requires chatId and messageId. Use it when the user asks, or as a sparing, natural acknowledgement when a reaction is more appropriate than a text reply. Do not react to every message.";

/**
 * Executor for telegram_react tool
 */
export const telegramReactExecutor: ToolExecutor<ReactParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const chatId = String(params.chatId);
    const { messageId, emoji } = params;

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
