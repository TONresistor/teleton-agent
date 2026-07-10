import { randomLong, toLong } from "../utils/gramjs-bigint.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { Api } from "telegram";
import type { PluginLogger, SimpleMessage, MediaSendOptions } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";
import { getApi, toSimpleMessage } from "./telegram-utils.js";
import { boundedLimit, requireNonEmpty, requirePositiveInteger } from "./validation.js";
import { createTelegramRuntime } from "./telegram/runtime.js";

/**
 * Creates the Telegram messages, media, and advanced SDK methods.
 * These extend the core TelegramSDK with additional capabilities.
 */
export function createTelegramMessagesSDK(
  bridge: ITelegramBridge,
  log: PluginLogger,
  mode?: "user" | "bot"
) {
  const { requireBridge, requireUserMode, getClient } = createTelegramRuntime(bridge, mode);

  return {
    // ─── Messages ──────────────────────────────────────────────

    async deleteMessage(chatId: string, messageId: number, revoke = true): Promise<void> {
      requireUserMode("deleteMessage");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to delete message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async forwardMessage(
      fromChatId: string,
      toChatId: string,
      messageId: number
    ): Promise<number | null> {
      requireUserMode("forwardMessage");
      requireBridge();
      requireNonEmpty(fromChatId, "Source chat ID");
      requireNonEmpty(toChatId, "Destination chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to forward message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async pinMessage(
      chatId: string,
      messageId: number,
      opts?: { silent?: boolean; unpin?: boolean }
    ): Promise<void> {
      requireUserMode("pinMessage");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to ${opts?.unpin ? "unpin" : "pin"} message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async searchMessages(chatId: string, query: string, limit = 20): Promise<SimpleMessage[]> {
      requireUserMode("searchMessages");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      const normalizedQuery = requireNonEmpty(query, "Search query");
      const bounded = boundedLimit(limit, 20, 100);
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const entity = await gramJsClient.getEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.Search({
            peer: entity,
            q: normalizedQuery,
            filter: new Api.InputMessagesFilterEmpty(),
            limit: bounded,
          })
        );

        const resultData = result as Api.messages.Messages;
        return (resultData.messages ?? [])
          .filter(
            (m): m is Api.Message =>
              m.className !== "MessageEmpty" && m.className !== "MessageService"
          )
          .map(toSimpleMessage);
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.searchMessages() failed:", error);
        return [];
      }
    },

    async scheduleMessage(
      chatId: string,
      text: string,
      scheduleDate: number
    ): Promise<number | null> {
      requireUserMode("scheduleMessage");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      const normalizedText = requireNonEmpty(text, "Message text");
      requirePositiveInteger(scheduleDate, "Schedule date");
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendMessage(chatId, {
          message: normalizedText,
          schedule: scheduleDate,
        });

        return result.id ?? null;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to schedule message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getReplies(chatId: string, messageId: number, limit = 50): Promise<SimpleMessage[]> {
      requireUserMode("getReplies");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
      const bounded = boundedLimit(limit, 50, 100);
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
            limit: bounded,
            maxId: 0,
            minId: 0,
            hash: toLong(0n),
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to get replies: ${getErrorMessage(error)}`,
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
      requireUserMode("sendPhoto");
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendFile(chatId, {
          file: photo,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
        });

        return result.id;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send photo: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendVideo(
      chatId: string,
      video: string | Buffer,
      opts?: MediaSendOptions
    ): Promise<number> {
      requireUserMode("sendVideo");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send video: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendVoice(
      chatId: string,
      voice: string | Buffer,
      opts?: MediaSendOptions
    ): Promise<number> {
      requireUserMode("sendVoice");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send voice: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendFile(
      chatId: string,
      file: string | Buffer,
      opts?: MediaSendOptions & { fileName?: string }
    ): Promise<number> {
      requireUserMode("sendFile");
      requireBridge();
      try {
        const gramJsClient = getClient();
        const Api = await getApi();

        const attributes: Api.TypeDocumentAttribute[] = [];
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send file: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendGif(chatId: string, gif: string | Buffer, opts?: MediaSendOptions): Promise<number> {
      requireUserMode("sendGif");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send GIF: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendSticker(chatId: string, sticker: string | Buffer): Promise<number> {
      requireUserMode("sendSticker");
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendFile(chatId, {
          file: sticker,
        });

        return result.id;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send sticker: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async downloadMedia(chatId: string, messageId: number): Promise<Buffer | null> {
      requireUserMode("downloadMedia");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
        const media = messages[0].media;
        const doc = media && "document" in media ? media.document : undefined;
        const docSize = doc && "size" in doc ? doc.size : undefined;
        if (docSize && Number(docSize) > MAX_DOWNLOAD_SIZE) {
          throw new PluginSDKError(
            `File too large (${Math.round(Number(docSize) / 1024 / 1024)}MB). Max: 50MB`,
            "OPERATION_FAILED"
          );
        }

        const buffer = await gramJsClient.downloadMedia(messages[0], {});
        return buffer ? Buffer.from(buffer as Buffer | string) : null;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to download media: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Scheduled Messages ────────────────────────────────────

    async getScheduledMessages(chatId: string): Promise<SimpleMessage[]> {
      requireUserMode("getScheduledMessages");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      try {
        const gramJsClient = getClient();
        const Api = await getApi();
        const peer = await gramJsClient.getInputEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.GetScheduledHistory({
            peer,
            hash: toLong(0n),
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getScheduledMessages() failed:", error);
        return [];
      }
    },

    async deleteScheduledMessage(chatId: string, messageId: number): Promise<void> {
      requireUserMode("deleteScheduledMessage");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to delete scheduled message: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendScheduledNow(chatId: string, messageId: number): Promise<void> {
      requireUserMode("sendScheduledNow");
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      requirePositiveInteger(messageId, "Message ID");
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send scheduled message now: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Advanced ──────────────────────────────────────────────

    async setTyping(chatId: string): Promise<void> {
      requireBridge();
      requireNonEmpty(chatId, "Chat ID");
      try {
        await bridge.setTyping(chatId);
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to set typing: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },
  };
}
