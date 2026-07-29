/**
 * telegram_send_dice - Send animated dice/games in Telegram
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SendDiceParams {
  chat_id: string;
  emoticon?: "🎲" | "🎯" | "🏀" | "⚽" | "🎰" | "🎳";
}

export const telegramSendDiceTool: Tool = {
  name: "telegram_send_dice",
  description: `Roll an animated dice or game message with a server-determined random result. Emoticon options: \ud83c\udfb2 (dice), \ud83c\udfaf (darts), \ud83c\udfc0 (basketball), \u26bd (football), \ud83c\udfb0 (slots), \ud83c\udfb3 (bowling). Returns the numeric outcome. Use when user asks 'roll a dice', 'spin the wheel', or 'play dice'.`,

  parameters: Type.Object({
    chat_id: Type.String({
      description: "Chat ID or username to send the dice to",
    }),
    emoticon: Type.Optional(
      Type.String({
        description: "Dice type: 🎲 (default), 🎯, 🏀, ⚽, 🎰, or 🎳",
        enum: ["🎲", "🎯", "🏀", "⚽", "🎰", "🎳"],
      })
    ),
  }),
};

export const telegramSendDiceExecutor: ToolExecutor<SendDiceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, emoticon = "🎲" } = params;

    const result = await context.bridge.sendDice(chat_id, emoticon);

    return {
      success: true,
      data: {
        chat_id,
        emoticon,
        message_id: result.id,
        value: result.value,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in telegram_send_dice");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
