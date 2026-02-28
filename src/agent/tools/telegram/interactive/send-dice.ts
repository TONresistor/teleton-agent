/**
 * telegram_send_dice - Send animated dice/games in Telegram
 */

import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SendDiceParams {
  chat_id: string;
  emoticon?: "🎲" | "🎯" | "🏀" | "⚽" | "🎰" | "🎳";
  reply_to?: number;
}

export const telegramSendDiceTool: Tool = {
  name: "telegram_send_dice",
  description: `Roll an animated dice or game message with a server-determined random result. Emoticon options: \ud83c\udfb2 (dice), \ud83c\udfaf (darts), \ud83c\udfc0 (basketball), \u26bd (football), \ud83c\udfb0 (slots), \ud83c\udfb3 (bowling). Returns the numeric outcome.`,

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
    reply_to: Type.Optional(
      Type.Number({
        description: "Message ID to reply to",
      })
    ),
  }),
};

export const telegramSendDiceExecutor: ToolExecutor<SendDiceParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, emoticon = "🎲", reply_to } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Send dice using SendMedia
    const result = await gramJsClient.invoke(
      new Api.messages.SendMedia({
        peer: chat_id,
        media: new Api.InputMediaDice({ emoticon }),
        message: "",
        randomId: randomLong(),
        replyTo: reply_to ? new Api.InputReplyToMessage({ replyToMsgId: reply_to }) : undefined,
      })
    );

    // Extract dice value from the result
    let value: number | undefined;
    let messageId: number | undefined;

    // Handle different response types
    if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
      for (const update of result.updates) {
        if (
          update instanceof Api.UpdateNewMessage ||
          update instanceof Api.UpdateNewChannelMessage
        ) {
          const msg = update.message;
          if (msg instanceof Api.Message && msg.media instanceof Api.MessageMediaDice) {
            value = msg.media.value;
            messageId = msg.id;
            break;
          }
        }
      }
    }

    // Interpret the result
    let interpretation = "";
    if (value !== undefined) {
      switch (emoticon) {
        case "🎲":
          interpretation = `Rolled ${value}`;
          break;
        case "🎯":
          interpretation = value === 6 ? "🎯 Bullseye!" : `Scored ${value}/6`;
          break;
        case "🏀":
          interpretation = value >= 4 ? "🏀 Score!" : `Missed (${value}/5)`;
          break;
        case "⚽":
          interpretation = value >= 4 ? "⚽ Goal!" : `Missed (${value}/5)`;
          break;
        case "🎰":
          interpretation = value === 64 ? "🎰 JACKPOT 777!" : `Spin result: ${value}/64`;
          break;
        case "🎳":
          interpretation = value === 6 ? "🎳 Strike!" : `Knocked ${value}/6 pins`;
          break;
      }
    }

    return {
      success: true,
      data: {
        chat_id,
        emoticon,
        value,
        interpretation,
        message_id: messageId,
        message: `${emoticon} ${interpretation}`,
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
