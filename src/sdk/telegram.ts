import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { isUserBridge } from "../telegram/bridge-guards.js";
import type { TelegramSDK, TelegramUser, SimpleMessage, PluginLogger } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";
import { createTelegramMessagesSDK } from "./telegram-messages.js";
import { createTelegramSocialSDK } from "./telegram-social.js";
import { createTelegramRuntime } from "./telegram/runtime.js";

export function createTelegramSDK(
  bridge: ITelegramBridge,
  log: PluginLogger,
  mode?: "user" | "bot"
): TelegramSDK {
  const telegramMode = mode ?? bridge.getMode();
  const { requireBridge, requireUserMode } = createTelegramRuntime(bridge, telegramMode);

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
