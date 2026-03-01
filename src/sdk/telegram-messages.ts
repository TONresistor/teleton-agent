import { randomLong } from "../utils/gramjs-bigint.js";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { Api } from "telegram";
import type { PluginLogger, SimpleMessage, MediaSendOptions } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import {
  requireBridge as requireBridgeUtil,
  getClient as getClientUtil,
  getApi,
  toSimpleMessage,
} from "./telegram-utils.js";

/**
 * Creates the Telegram messages, media, and advanced SDK methods.
 * These extend the core TelegramSDK with additional capabilities.
 */
export function createTelegramMessagesSDK(bridge: TelegramBridge, log: PluginLogger) {
  function requireBridge(): void {
    requireBridgeUtil(bridge);
  }

  function getClient() {
    return getClientUtil(bridge);
  }

  return {
    // ─── Messages ──────────────────────────────────────────────

    async deleteMessage(chatId: string, messageId: number, revoke = true): Promise<void> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const isChannel = chatId.startsWith("-100");
        if (isChannel) {
          const channel = await gramJsClient.getEntity(chatId);
          await gramJsClient.invoke(
            new Api.channels.DeleteMessages({
              channel,
              id: [messageId],
            })
          );
        } else {
          await gramJsClient.invoke(
            new Api.messages.DeleteMessages({
              id: [messageId],
              revoke,
            })
          );
        }
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to delete message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async forwardMessage(
      fromChatId: string,
      toChatId: string,
      messageId: number
    ): Promise<number | null> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const result = await gramJsClient.invoke(
          new Api.messages.ForwardMessages({
            fromPeer: fromChatId,
            toPeer: toChatId,
            id: [messageId],
            randomId: [randomLong()],
          })
        );

        // Extract forwarded message ID from updates
        if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
          for (const update of result.updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return (update as Api.UpdateNewMessage).message.id;
            }
          }
        }
        return null;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to forward message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async pinMessage(
      chatId: string,
      messageId: number,
      opts?: { silent?: boolean; unpin?: boolean }
    ): Promise<void> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        await gramJsClient.invoke(
          new Api.messages.UpdatePinnedMessage({
            peer: chatId,
            id: messageId,
            silent: opts?.silent,
            unpin: opts?.unpin,
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to ${opts?.unpin ? "unpin" : "pin"} message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async searchMessages(chatId: string, query: string, limit = 20): Promise<SimpleMessage[]> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const entity = await gramJsClient.getEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.Search({
            peer: entity,
            q: query,
            filter: new Api.InputMessagesFilterEmpty(),
            limit,
          })
        );

        const resultData = result as Api.messages.Messages;
        return (resultData.messages ?? []).map(toSimpleMessage);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.searchMessages() failed:", err);
        return [];
      }
    },

    async scheduleMessage(
      chatId: string,
      text: string,
      scheduleDate: number
    ): Promise<number | null> {
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendMessage(chatId, {
          message: text,
          schedule: scheduleDate,
        });

        return result.id ?? null;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to schedule message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getReplies(chatId: string, messageId: number, limit = 50): Promise<SimpleMessage[]> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();
        const peer = await gramJsClient.getInputEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.GetReplies({
            peer,
            msgId: messageId,
            offsetId: 0,
            offsetDate: 0,
            addOffset: 0,
            limit,
            maxId: 0,
            minId: 0,
            hash: 0n as any,
          })
        );

        const messages: SimpleMessage[] = [];
        if ("messages" in result) {
          for (const msg of result.messages) {
            if (msg.className === "Message") {
              messages.push(toSimpleMessage(msg));
            }
          }
        }

        // Sort oldest first for thread reading
        messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        return messages;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get replies: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Media ─────────────────────────────────────────────────

    async sendPhoto(
      chatId: string,
      photo: string | Buffer,
      opts?: MediaSendOptions
    ): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendFile(chatId, {
          file: photo,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send photo: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendVideo(
      chatId: string,
      video: string | Buffer,
      opts?: MediaSendOptions
    ): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const result = await gramJsClient.sendFile(chatId, {
          file: video,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          forceDocument: false,
          attributes: [
            new Api.DocumentAttributeVideo({
              roundMessage: false,
              supportsStreaming: true,
              duration: opts?.duration ?? 0,
              w: opts?.width ?? 0,
              h: opts?.height ?? 0,
            }),
          ],
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send video: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendVoice(
      chatId: string,
      voice: string | Buffer,
      opts?: MediaSendOptions
    ): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const result = await gramJsClient.sendFile(chatId, {
          file: voice,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          attributes: [
            new Api.DocumentAttributeAudio({ voice: true, duration: opts?.duration ?? 0 }),
          ],
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send voice: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendFile(
      chatId: string,
      file: string | Buffer,
      opts?: MediaSendOptions & { fileName?: string }
    ): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const attributes: any[] = [];
        if (opts?.fileName) {
          attributes.push(new Api.DocumentAttributeFilename({ fileName: opts.fileName }));
        }

        const result = await gramJsClient.sendFile(chatId, {
          file,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          forceDocument: true,
          attributes: attributes.length > 0 ? attributes : undefined,
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send file: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendGif(chatId: string, gif: string | Buffer, opts?: MediaSendOptions): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const result = await gramJsClient.sendFile(chatId, {
          file: gif,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          attributes: [new Api.DocumentAttributeAnimated()],
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send GIF: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendSticker(chatId: string, sticker: string | Buffer): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendFile(chatId, {
          file: sticker,
        });

        return result.id;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send sticker: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async downloadMedia(chatId: string, messageId: number): Promise<Buffer | null> {
      requireBridge();
      const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB
      try {
        const gramJsClient = getClient();

        const messages = await gramJsClient.getMessages(chatId, {
          ids: [messageId],
        });

        if (!messages || messages.length === 0 || !messages[0].media) {
          return null;
        }

        // Check file size before downloading to prevent OOM
        const doc = (messages[0].media as any)?.document;
        if (doc?.size && Number(doc.size) > MAX_DOWNLOAD_SIZE) {
          throw new PluginSDKError(
            `File too large (${Math.round(Number(doc.size) / 1024 / 1024)}MB). Max: 50MB`,
            "OPERATION_FAILED"
          );
        }

        const buffer = await gramJsClient.downloadMedia(messages[0], {});
        return buffer ? Buffer.from(buffer as any) : null;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to download media: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Scheduled Messages ────────────────────────────────────

    async getScheduledMessages(chatId: string): Promise<SimpleMessage[]> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();
        const peer = await gramJsClient.getInputEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.GetScheduledHistory({
            peer,
            hash: 0n as any,
          })
        );

        const messages: SimpleMessage[] = [];
        if ("messages" in result) {
          for (const msg of result.messages) {
            if (msg.className === "Message") {
              messages.push(toSimpleMessage(msg));
            }
          }
        }
        return messages;
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getScheduledMessages() failed:", err);
        return [];
      }
    },

    async deleteScheduledMessage(chatId: string, messageId: number): Promise<void> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();
        const peer = await gramJsClient.getInputEntity(chatId);

        await gramJsClient.invoke(
          new Api.messages.DeleteScheduledMessages({
            peer,
            id: [messageId],
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to delete scheduled message: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendScheduledNow(chatId: string, messageId: number): Promise<void> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();
        const peer = await gramJsClient.getInputEntity(chatId);

        await gramJsClient.invoke(
          new Api.messages.SendScheduledMessages({
            peer,
            id: [messageId],
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send scheduled message now: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Advanced ──────────────────────────────────────────────

    async setTyping(chatId: string): Promise<void> {
      requireBridge();
      try {
        await bridge.setTyping(chatId);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to set typing: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },
  };
}
