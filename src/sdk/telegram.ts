import type { TelegramBridge } from "../telegram/bridge.js";
import { randomBytes } from "crypto";
import type {
  TelegramSDK,
  SendMessageOptions,
  EditMessageOptions,
  DiceResult,
  TelegramUser,
  SimpleMessage,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { createTelegramMessagesSDK } from "./telegram-messages.js";
import { createTelegramSocialSDK } from "./telegram-social.js";

export function createTelegramSDK(bridge: TelegramBridge, log: PluginLogger): TelegramSDK {
  function requireBridge(): void {
    if (!bridge.isAvailable()) {
      throw new PluginSDKError(
        "Telegram bridge not connected. SDK telegram methods can only be called at runtime (inside tool executors or start()), not during plugin loading.",
        "BRIDGE_NOT_CONNECTED"
      );
    }
  }

  return {
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to edit message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendDice(chatId, emoticon, replyToId) {
      requireBridge();
      try {
        const gramJsClient = bridge.getClient().getClient();
        const { Api } = await import("telegram");

        const result = await gramJsClient.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaDice({ emoticon }),
            message: "",
            randomId: randomBytes(8).readBigUInt64BE() as any,
            replyTo: replyToId
              ? new Api.InputReplyToMessage({ replyToMsgId: replyToId })
              : undefined,
          })
        );

        let value: number | undefined;
        let messageId: number | undefined;

        if (result.className === "Updates" || result.className === "UpdatesCombined") {
          for (const update of (result as any).updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              const msg = update.message;
              if (msg?.media?.className === "MessageMediaDice") {
                value = msg.media.value;
                messageId = msg.id;
                break;
              }
            }
          }
        }

        if (value === undefined || messageId === undefined) {
          throw new Error("Could not extract dice value from Telegram response");
        }

        return { value, messageId };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send dice: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendReaction(chatId, messageId, emoji) {
      requireBridge();
      try {
        await bridge.sendReaction(chatId, messageId, emoji);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send reaction: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getMessages(chatId, limit): Promise<SimpleMessage[]> {
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
      } catch (err) {
        log.error("telegram.getMessages() failed:", err);
        return [];
      }
    },

    getMe(): TelegramUser | null {
      try {
        const me = bridge.getClient()?.getMe?.();
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

    getRawClient(): unknown | null {
      if (!bridge.isAvailable()) return null;
      try {
        return bridge.getClient().getClient();
      } catch {
        return null;
      }
    },

    // Spread extended methods from sub-modules
    ...createTelegramMessagesSDK(bridge, log),
    ...createTelegramSocialSDK(bridge, log),
  };
}
