/**
 * Generic inline bot send tool — sends plugin inline results into chats.
 * Uses Telegram's userbot-to-bot inline query flow for plugin-generated cards.
 */

import { Api } from "telegram";
import { Type } from "@sinclair/typebox";
import { randomLong } from "../../../../utils/gramjs-bigint.js";
import type { Tool, ToolExecutor } from "../../types.js";
import { createLogger } from "../../../../utils/logger.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("BotInlineSend");

interface BotInlineSendParams {
  plugin: string;
  query: string;
  resultIndex?: number;
}

export const botInlineSendTool: Tool = {
  name: "bot_inline_send",
  description:
    "Send a plugin's inline card (with buttons) into the current chat via the bot inline query mechanism. Requires bot_username configured and the named plugin to have an inline handler. NOT a general-purpose send — use telegram_send_buttons for custom buttons or telegram_send_message for text.",
  parameters: Type.Object({
    plugin: Type.String({ description: "Plugin name that handles the inline query (e.g. 'cats')" }),
    query: Type.String({ description: "Query to send to the plugin handler (e.g. 'random')" }),
    resultIndex: Type.Optional(
      Type.Number({ description: "Which result to send (0-based index, default: 0)" })
    ),
  }),
};

export const botInlineSendExecutor: ToolExecutor<BotInlineSendParams> = async (params, context) => {
  const { plugin, query, resultIndex = 0 } = params;

  const botUsername = context.config?.telegram?.bot_username;
  if (!botUsername) {
    return {
      success: false,
      error: "Bot not configured. Set telegram.bot_username in config.",
    };
  }

  if (!context.bridge?.isAvailable()) {
    return {
      success: false,
      error: "Telegram bridge not available.",
    };
  }

  try {
    const gramJsClient = getClient(context.bridge);

    // Resolve bot and chat entities
    const bot = await gramJsClient.getInputEntity(botUsername);
    const chatId = context.chatId;
    const peer = await gramJsClient.getInputEntity(
      chatId.startsWith("-") ? Number(chatId) : chatId
    );

    // Query the inline bot with plugin prefix
    const prefixedQuery = `${plugin}:${query}`;
    const results = await gramJsClient.invoke(
      new Api.messages.GetInlineBotResults({
        bot,
        peer,
        query: prefixedQuery,
        offset: "",
      })
    );

    if (!results.results || results.results.length === 0) {
      return {
        success: false,
        error: `No inline results returned for plugin "${plugin}" query "${query}". The plugin may not have an inline handler or returned empty results.`,
      };
    }

    if (resultIndex >= results.results.length) {
      return {
        success: false,
        error: `Result index ${resultIndex} out of range. Only ${results.results.length} result(s) available.`,
      };
    }

    const resultToSend = results.results[resultIndex];

    // Send the inline result as a message in the chat
    await gramJsClient.invoke(
      new Api.messages.SendInlineBotResult({
        peer,
        queryId: results.queryId,
        id: resultToSend.id,
        randomId: randomLong(),
      })
    );

    log.info({ plugin, queryLength: query.length, resultIndex }, "Inline bot result sent");

    return {
      success: true,
      data: {
        plugin,
        query,
        resultIndex,
        resultId: resultToSend.id,
        totalResults: results.results.length,
      },
    };
  } catch (error) {
    log.error({ err: error }, `Failed to send inline bot result for plugin "${plugin}"`);
    return {
      success: false,
      error: `Failed to send inline result: ${getErrorMessage(error)}`,
    };
  }
};
