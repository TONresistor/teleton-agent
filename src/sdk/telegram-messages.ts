import { randomBytes } from "crypto";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { PluginLogger, SimpleMessage, MediaSendOptions } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";

/**
 * Creates the Telegram messages, media, and advanced SDK methods.
 * These extend the core TelegramSDK with additional capabilities.
 */
export function createTelegramMessagesSDK(bridge: TelegramBridge, log: PluginLogger) {
  function requireBridge(): void {
    if (!bridge.isAvailable()) {
      throw new PluginSDKError(
        "Telegram bridge not connected. SDK telegram methods can only be called at runtime (inside tool executors or start()), not during plugin loading.",
        "BRIDGE_NOT_CONNECTED"
      );
    }
  }

  function getClient() {
    return bridge.getClient().getClient();
  }

  function toSimpleMessage(msg: any): SimpleMessage {
    return {
      id: msg.id,
      text: msg.message ?? "",
      senderId: Number(msg.fromId?.userId ?? msg.fromId?.channelId ?? 0),
      timestamp: new Date(msg.date * 1000),
    };
  }

  return {
    // ─── Messages ──────────────────────────────────────────────

    async deleteMessage(chatId: string, messageId: number, revoke = true): Promise<void> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const { Api } = await import("telegram");

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

    async forwardMessage(fromChatId: string, toChatId: string, messageId: number): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();
        const { Api } = await import("telegram");

        const result = await gramJsClient.invoke(
          new Api.messages.ForwardMessages({
            fromPeer: fromChatId,
            toPeer: toChatId,
            id: [messageId],
            randomId: [randomBytes(8).readBigUInt64BE() as any],
          })
        );

        // Extract forwarded message ID from updates
        const updates = result as any;
        if (updates.updates) {
          for (const update of updates.updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return update.message.id;
            }
          }
        }
        return 0;
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
        const { Api } = await import("telegram");

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
        const { Api } = await import("telegram");

        const entity = await gramJsClient.getEntity(chatId);

        const result = await gramJsClient.invoke(
          new Api.messages.Search({
            peer: entity,
            q: query,
            filter: new Api.InputMessagesFilterEmpty(),
            limit,
          })
        );

        const resultData = result as any;
        return (resultData.messages ?? []).map(toSimpleMessage);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.searchMessages() failed:", err);
        return [];
      }
    },

    async scheduleMessage(chatId: string, text: string, scheduleDate: number): Promise<number> {
      requireBridge();
      try {
        const gramJsClient = getClient();

        const result = await gramJsClient.sendMessage(chatId, {
          message: text,
          schedule: scheduleDate,
        });

        return (result as any).id ?? 0;
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
        const { Api } = await import("telegram");
        const bigInt = ((await import("big-integer")) as any).default;

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
            hash: bigInt(0),
          })
        );

        const messages: SimpleMessage[] = [];
        if ("messages" in result) {
          for (const msg of result.messages) {
            if ((msg as any).className === "Message") {
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
        const { Api } = await import("telegram");

        const result = await gramJsClient.sendFile(chatId, {
          file: video,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          forceDocument: false,
          attributes: [
            new Api.DocumentAttributeVideo({
              roundMessage: false,
              supportsStreaming: true,
              duration: 0,
              w: 0,
              h: 0,
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
        const { Api } = await import("telegram");

        const result = await gramJsClient.sendFile(chatId, {
          file: voice,
          caption: opts?.caption,
          replyTo: opts?.replyToId,
          attributes: [new Api.DocumentAttributeAudio({ voice: true, duration: 0 })],
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
        const { Api } = await import("telegram");

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
        const { Api } = await import("telegram");

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
      try {
        const gramJsClient = getClient();

        const messages = await gramJsClient.getMessages(chatId, {
          ids: [messageId],
        });

        if (!messages || messages.length === 0 || !messages[0].media) {
          return null;
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
