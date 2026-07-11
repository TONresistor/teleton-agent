import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { isUserBridge } from "../telegram/bridge-guards.js";
import type { TelegramSDK, TelegramUser, SimpleMessage, PluginLogger } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";
import { randomLong } from "../utils/gramjs-bigint.js";
import { createTelegramMessagesSDK } from "./telegram-messages.js";
import { createTelegramSocialSDK } from "./telegram-social.js";
import { createTelegramRuntime } from "./telegram/runtime.js";

export function createTelegramSDK(
  bridge: ITelegramBridge,
  log: PluginLogger,
  mode?: "user" | "bot"
): TelegramSDK {
  const telegramMode = mode ?? bridge.getMode();
  const { requireBridge, requireUserMode, userOp } = createTelegramRuntime(bridge, telegramMode);

  return {
    getMode() {
      return telegramMode;
    },
    async sendMessage(chatId, text, opts) {
      requireBridge();
      try {
        const msg = await bridge.sendMessage({
          chatId,
          text,
          replyToId: opts?.replyToId,
          inlineKeyboard: opts?.inlineKeyboard,
        });
        return msg.id;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async editMessage(chatId, messageId, text, opts) {
      requireBridge();
      try {
        const msg = await bridge.editMessage({
          chatId,
          messageId,
          text,
          inlineKeyboard: opts?.inlineKeyboard,
        });
        return typeof msg?.id === "number" ? msg.id : messageId;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to edit message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendDice(chatId, emoticon, _replyToId) {
      requireBridge();
      try {
        const sent = await bridge.sendDice(chatId, emoticon);
        return { value: 0, messageId: sent.id };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send dice: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendReaction(chatId, messageId, emoji) {
      requireBridge();
      try {
        await bridge.sendReaction(chatId, messageId, emoji);
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send reaction: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getMessages(chatId, limit): Promise<SimpleMessage[]> {
      requireUserMode("getMessages");
      requireBridge();
      try {
        const messages = await bridge.getMessages(chatId, limit ?? 50);
        return messages.map((m) => ({
          id: m.id,
          text: m.text,
          senderId: m.senderId,
          senderUsername: m.senderUsername,
          timestamp: m.timestamp,
        }));
      } catch (error) {
        log.error("telegram.getMessages() failed:", error);
        return [];
      }
    },

    async sendInlineBotResult(chatId, botUsername, query, index = 0) {
      const normalizedBot = botUsername.trim().replace(/^@/, "");
      const normalizedQuery = query.trim();
      if (!normalizedBot) {
        throw new PluginSDKError("Inline bot username is required", "OPERATION_FAILED");
      }
      if (!normalizedQuery) {
        throw new PluginSDKError("Inline query is required", "OPERATION_FAILED");
      }
      if (!Number.isInteger(index) || index < 0 || index > 49) {
        throw new PluginSDKError(
          "Inline result index must be an integer from 0 to 49",
          "OPERATION_FAILED"
        );
      }

      return userOp("sendInlineBotResult", "send inline bot result", async ({ client, Api }) => {
        const [bot, peer] = await Promise.all([
          client.getEntity(normalizedBot),
          client.getInputEntity(chatId),
        ]);
        const results = await client.invoke(
          new Api.messages.GetInlineBotResults({
            bot,
            peer,
            query: normalizedQuery,
            offset: "",
          })
        );
        const available = results.results ?? [];
        if (available.length === 0) {
          throw new PluginSDKError(
            `No inline results found for "${normalizedQuery}"`,
            "OPERATION_FAILED"
          );
        }
        if (index >= available.length) {
          throw new PluginSDKError(
            `Only ${available.length} inline results available; index ${index} is out of range`,
            "OPERATION_FAILED"
          );
        }

        const chosen = available[index];
        await client.invoke(
          new Api.messages.SendInlineBotResult({
            peer,
            queryId: results.queryId,
            id: chosen.id,
            randomId: randomLong(),
          })
        );

        return {
          query: normalizedQuery,
          sentIndex: index,
          totalResults: available.length,
          title: chosen.title ?? null,
          description: chosen.description ?? null,
          type: chosen.type ?? null,
        };
      });
    },

    getMe(): TelegramUser | null {
      requireUserMode("getMe");
      try {
        if (!isUserBridge(bridge)) return null;
        const me = bridge.getClient().getMe();
        if (!me) return null;
        return {
          id: Number(me.id),
          username: me.username,
          firstName: me.firstName,
          isBot: me.isBot,
        };
      } catch {
        return null;
      }
    },

    isAvailable(): boolean {
      return bridge.isAvailable();
    },

    // Spread extended methods from sub-modules
    ...createTelegramMessagesSDK(bridge, log, telegramMode),
    ...createTelegramSocialSDK(bridge, log, telegramMode),
  };
}
