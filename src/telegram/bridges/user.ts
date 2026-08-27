import { TelegramUserClient, type TelegramClientConfig } from "../client.js";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { Api, utils } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { createLogger } from "../../utils/logger.js";
import { withFloodRetry } from "../flood-retry.js";
import { randomLong } from "../../utils/gramjs-bigint.js";
import { getGramJSErrorMessage } from "../../utils/errors.js";
import { markdownToTelegramHtml } from "../formatting.js";
import {
  classifyRichMessageMedia,
  resolveTelegramMessageContent,
  resolveTelegramMessageText,
} from "../rich-message.js";
import { readRichDocumentMetadata } from "../media-metadata.js";
import { classifyMedia } from "../bridge-interface.js";
import type {
  ITelegramBridge,
  TelegramMessage,
  InlineButton, // eslint-disable-line @typescript-eslint/no-unused-vars -- re-exported for backward compat
  SendMessageOptions,
  SendRichMessageOptions,
  RichMessageMediaUpload,
  SentMessage,
  SentDiceMessage,
  EditMessageOptions,
  ReplyContext,
  BotInfo,
  ChatInfo,
} from "../bridge-interface.js";

export type { TelegramMessage, InlineButton, SendMessageOptions } from "../bridge-interface.js";

const log = createLogger("Telegram");

/** Max time to wait for getSender() before giving up (deleted accounts, timeouts). */
const SENDER_RESOLVE_TIMEOUT_MS = 5000;

const RICH_FORMATTING_PATTERNS = [
  /(?:^|\n)\s{0,3}#{1,6}\s+\S/, // heading
  /(?:^|\n)\s{0,3}(?:>\s*|[-+*]\s+|\d+[.)]\s+)\S/, // quote or list
  /(?:^|\n)\s{0,3}-\s+\[[ xX]\]\s+\S/, // task list
  /(?:^|\n)\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$)/, // horizontal rule
  /(?:^|\n)\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*:?-{3,}:?\s*\|?\s*(?:\n|$)/, // table
  /```[\s\S]*?```|~~~[\s\S]*?~~~/, // fenced code
  /`[^`\n]+`/, // inline code
  /!?\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/, // link or image
  /<https?:\/\/[^>\s]+>/, // autolink
  /\*\*\S(?:[\s\S]*?\S)?\*\*/, // bold
  /(?<![\w_])__(?!_)(?=[^_\n]*\s)[^_\n]*?\S__(?![\w_])/, // underscore bold with spaces
  /~~\S(?:[\s\S]*?\S)?~~|\|\|\S(?:[\s\S]*?\S)?\|\|/, // strike or spoiler
  /(?:^|[^\w])\*\S(?:[^*\n]*?\S)?\*(?!\w)/, // italic with asterisks
  /(?<![\w_])_(?!_)\S(?:[^_\n]*?\S)?_(?![\w_])/, // italic with underscores
  /\\(?:\(|\[)[\s\S]+?\\(?:\)|\])|\$\$[\s\S]+?\$\$/, // display LaTeX
  /(?<![$\\])\$(?![$\s])[^$\n]+?(?<![\s\\])\$(?![\w$])/, // inline LaTeX
  /<\/?(?:a|b|blockquote|code|del|details|em|i|pre|s|strong|sub|summary|sup|tg-spoiler|u)(?:\s[^>]*)?>/i, // supported HTML
];

function hasRichFormatting(text: string): boolean {
  return RICH_FORMATTING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Rich Markdown can be rejected deterministically when the account does not
 * have the feature yet or the server cannot parse the generated markup. Only
 * those pre-send validation failures are safe to retry as a classic message.
 * Network/timeouts remain ambiguous and must not fall back, or we could send
 * the same message twice after Telegram accepted the first request.
 */
function canFallbackFromRichMessage(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code !== 400 && code !== 403 && code !== 406) {
    return false;
  }

  const rpcError = getGramJSErrorMessage(error)?.toUpperCase();
  if (!rpcError) return false;

  return (
    /^RICH_(?:MESSAGE|TEXT)(?:_[A-Z0-9]+)*$/.test(rpcError) ||
    rpcError === "MESSAGE_EMPTY" ||
    rpcError === "INPUT_CONSTRUCTOR_INVALID" ||
    rpcError === "PREMIUM_ACCOUNT_REQUIRED"
  );
}

function sentMessageFromUpdates(result: Api.TypeUpdates, chatId: string): SentMessage {
  if (
    result instanceof Api.UpdateShortSentMessage ||
    result instanceof Api.UpdateShortMessage ||
    result instanceof Api.UpdateShortChatMessage
  ) {
    return { id: result.id, date: result.date, chatId };
  }

  if (result instanceof Api.UpdateShort) {
    const update = result.update;
    if (
      (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) &&
      update.message instanceof Api.Message
    ) {
      return { id: update.message.id, date: update.message.date, chatId };
    }
    if (update instanceof Api.UpdateMessageID) {
      return { id: update.id, date: result.date, chatId };
    }
  }

  if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
    let mappedId: number | undefined;
    for (const update of result.updates) {
      if (
        (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) &&
        update.message instanceof Api.Message
      ) {
        return { id: update.message.id, date: update.message.date, chatId };
      }
      if (update instanceof Api.UpdateMessageID) {
        mappedId = update.id;
      }
    }
    if (mappedId !== undefined) {
      return { id: mappedId, date: result.date, chatId };
    }
  }

  // The request succeeded, so never resend solely because Telegram returned an
  // update shape without a message object.
  return { id: 0, date: Math.floor(Date.now() / 1000), chatId };
}

export class GramJSUserBridge implements ITelegramBridge {
  private client: TelegramUserClient;
  private ownUserId?: bigint;
  private ownUsername?: string;
  private peerCache: Map<string, Api.TypePeer> = new Map();

  constructor(config: TelegramClientConfig) {
    this.client = new TelegramUserClient(config);
  }

  /** Cache a chat's peer for later resolution, evicting the oldest past a cap. */
  private cachePeer(chatId: string, peer: Api.TypePeer): void {
    this.peerCache.set(chatId, peer);
    if (this.peerCache.size > 5000) {
      const oldest = this.peerCache.keys().next().value;
      if (oldest !== undefined) this.peerCache.delete(oldest);
    }
  }

  getMode(): "user" | "bot" {
    return "user";
  }

  requiresOffsetDedup(): boolean {
    return true;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const me = this.client.getMe();
    if (me) {
      this.ownUserId = me.id;
      this.ownUsername = me.username?.toLowerCase();
    }

    try {
      await this.getDialogs();
    } catch (error) {
      log.warn({ err: error }, "Could not load dialogs");
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  isAvailable(): boolean {
    return this.client.isConnected();
  }

  getOwnUserId(): bigint | undefined {
    return this.ownUserId;
  }

  getUsername(): string | undefined {
    const me = this.client.getMe();
    return me?.username;
  }

  async getMe(): Promise<BotInfo | undefined> {
    const me = this.client.getMe();
    if (!me) return undefined;
    return {
      id: Number(me.id),
      username: me.username,
      firstName: me.firstName ?? "Unknown",
      isBot: me.isBot,
    };
  }

  async getMessages(chatId: string, limit: number = 50): Promise<TelegramMessage[]> {
    try {
      const peer = this.peerCache.get(chatId) || chatId;
      const messages = await this.client.getMessages(peer, { limit });
      const results = await Promise.allSettled(messages.map((msg) => this.parseMessage(msg)));
      return results
        .filter((r): r is PromiseFulfilledResult<TelegramMessage> => r.status === "fulfilled")
        .map((r) => r.value);
    } catch (error) {
      log.error({ err: error }, "Error getting messages");
      return [];
    }
  }

  async sendMessage(
    options: SendMessageOptions & { _rawPeer?: Api.TypePeer }
  ): Promise<SentMessage> {
    try {
      const peer = options._rawPeer || this.peerCache.get(options.chatId) || options.chatId;

      let buttons: Api.ReplyInlineMarkup | undefined;
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        buttons = this.buildInlineMarkup(options.inlineKeyboard);
      }

      if (hasRichFormatting(options.text)) {
        try {
          const result = await withFloodRetry(
            () =>
              this.client.getClient().invoke(
                new Api.messages.SendMessage({
                  peer,
                  message: "",
                  randomId: randomLong(),
                  replyTo:
                    options.replyToId !== undefined
                      ? new Api.InputReplyToMessage({ replyToMsgId: options.replyToId })
                      : undefined,
                  replyMarkup: buttons,
                  noWebpage: true,
                  richMessage: new Api.InputRichMessageMarkdown({
                    markdown: options.text,
                  }),
                })
              ),
            undefined,
            undefined,
            options.chatId
          );

          return sentMessageFromUpdates(result, options.chatId);
        } catch (error) {
          if (!canFallbackFromRichMessage(error)) {
            throw error;
          }
          log.warn(
            { err: error, chatId: options.chatId },
            "Rich Markdown unavailable or invalid; falling back to a classic message"
          );
        }
      }

      let msg: Api.Message;
      if (buttons) {
        const gramJsClient = this.client.getClient();
        msg = await withFloodRetry(
          () =>
            gramJsClient.sendMessage(peer, {
              message: options.text,
              replyTo: options.replyToId,
              buttons,
            }),
          undefined,
          undefined,
          options.chatId
        );
      } else {
        msg = await withFloodRetry(
          () =>
            this.client.sendMessage(peer, {
              message: options.text,
              replyTo: options.replyToId,
            }),
          undefined,
          undefined,
          options.chatId
        );
      }

      return { id: msg.id, date: msg.date, chatId: options.chatId };
    } catch (error) {
      log.error({ err: error }, "Error sending message");
      throw error;
    }
  }

  /** Build a GramJS inline-keyboard markup from the bridge's button rows. */
  private buildInlineMarkup(
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>
  ): Api.ReplyInlineMarkup {
    return new Api.ReplyInlineMarkup({
      rows: inlineKeyboard.map(
        (row) =>
          new Api.KeyboardInlineButtonRow({
            buttons: row.map(
              (btn) =>
                new Api.KeyboardInlineButton({
                  text: btn.text,
                  type: new Api.InlineButtonTypeCallback({
                    data: Buffer.from(btn.callback_data),
                  }),
                })
            ),
          })
      ),
    });
  }

  private async uploadRichMessageMedia(
    peer: Api.TypeEntityLike,
    chatId: string,
    media: RichMessageMediaUpload
  ): Promise<Api.TypeInputRichFile> {
    const gramJsClient = this.client.getClient();
    const file = new CustomFile(basename(media.path), statSync(media.path).size, media.path);

    if (media.type === "photo") {
      const uploadedFile = await gramJsClient.uploadFile({
        file,
        workers: 4,
      });
      const uploadedMedia = await withFloodRetry(
        () =>
          gramJsClient.invoke(
            new Api.messages.UploadMedia({
              peer,
              media: new Api.InputMediaUploadedPhoto({
                file: uploadedFile,
              }),
            })
          ),
        undefined,
        undefined,
        chatId
      );
      const inputPhoto = utils.getInputPhoto(uploadedMedia);
      if (!(inputPhoto instanceof Api.InputPhoto)) {
        throw new Error(`Telegram did not return an uploaded photo for media "${media.id}"`);
      }
      return new Api.InputRichFilePhoto({
        id: media.id,
        photo: inputPhoto,
      });
    }

    const generated = utils.getAttributes(file, {
      supportsStreaming: media.type === "video",
    });
    const metadata = await readRichDocumentMetadata(media.path, media.type);
    const attrs: Api.TypeDocumentAttribute[] = generated.attrs.filter(
      (attribute) =>
        !(attribute instanceof Api.DocumentAttributeVideo) &&
        !(attribute instanceof Api.DocumentAttributeAudio)
    );
    if (media.type === "video") {
      if (metadata.width === undefined || metadata.height === undefined) {
        throw new Error(`Telegram video metadata is incomplete for media "${media.id}"`);
      }
      attrs.push(
        new Api.DocumentAttributeVideo({
          duration: metadata.duration,
          w: metadata.width,
          h: metadata.height,
          supportsStreaming: true,
        })
      );
    } else {
      attrs.push(
        new Api.DocumentAttributeAudio({
          duration: Math.max(1, Math.round(metadata.duration)),
        })
      );
    }

    const uploadedFile = await gramJsClient.uploadFile({
      file,
      workers: 4,
    });
    const uploadedMedia = await withFloodRetry(
      () =>
        gramJsClient.invoke(
          new Api.messages.UploadMedia({
            peer,
            media: new Api.InputMediaUploadedDocument({
              file: uploadedFile,
              mimeType: generated.mimeType,
              attributes: attrs,
            }),
          })
        ),
      undefined,
      undefined,
      chatId
    );
    const inputDocument = utils.getInputDocument(uploadedMedia);
    if (!(inputDocument instanceof Api.InputDocument)) {
      throw new Error(`Telegram did not return an uploaded document for media "${media.id}"`);
    }
    return new Api.InputRichFileDocument({
      id: media.id,
      document: inputDocument,
    });
  }

  async sendRichMessage(options: SendRichMessageOptions): Promise<SentMessage> {
    try {
      const peer = this.peerCache.get(options.chatId) || options.chatId;
      const files: Api.TypeInputRichFile[] = [];
      for (const media of options.media) {
        files.push(await this.uploadRichMessageMedia(peer, options.chatId, media));
      }

      const result = await withFloodRetry(
        () =>
          this.client.getClient().invoke(
            new Api.messages.SendMessage({
              peer,
              message: "",
              randomId: randomLong(),
              replyTo:
                options.replyToId !== undefined
                  ? new Api.InputReplyToMessage({ replyToMsgId: options.replyToId })
                  : undefined,
              noWebpage: true,
              richMessage: new Api.InputRichMessageMarkdown({
                markdown: options.text,
                files,
              }),
            })
          ),
        undefined,
        undefined,
        options.chatId
      );

      return sentMessageFromUpdates(result, options.chatId);
    } catch (error) {
      log.error({ err: error, chatId: options.chatId }, "Error sending Rich Message with media");
      throw error;
    }
  }

  async editMessage(options: EditMessageOptions): Promise<SentMessage> {
    try {
      const peer = this.peerCache.get(options.chatId) || options.chatId;

      let buttons: Api.ReplyInlineMarkup | undefined;
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        buttons = this.buildInlineMarkup(options.inlineKeyboard);
      }

      const gramJsClient = this.client.getClient();
      if (hasRichFormatting(options.text)) {
        try {
          const result = await withFloodRetry(
            () =>
              gramJsClient.invoke(
                new Api.messages.EditMessage({
                  peer,
                  id: options.messageId,
                  replyMarkup: buttons,
                  noWebpage: true,
                  richMessage: new Api.InputRichMessageMarkdown({
                    markdown: options.text,
                  }),
                })
              ),
            undefined,
            undefined,
            options.chatId
          );

          const updates =
            result instanceof Api.UpdateShort
              ? [result.update]
              : result instanceof Api.Updates || result instanceof Api.UpdatesCombined
                ? result.updates
                : [];
          const messageUpdate = updates.find(
            (update) =>
              update instanceof Api.UpdateEditMessage ||
              update instanceof Api.UpdateEditChannelMessage
          );
          if (
            messageUpdate &&
            "message" in messageUpdate &&
            messageUpdate.message instanceof Api.Message
          ) {
            return {
              id: messageUpdate.message.id,
              date: messageUpdate.message.date,
              chatId: options.chatId,
            };
          }

          return {
            id: options.messageId,
            date: Math.floor(Date.now() / 1000),
            chatId: options.chatId,
          };
        } catch (error) {
          if (!canFallbackFromRichMessage(error)) {
            throw error;
          }
          log.warn(
            { err: error, chatId: options.chatId, messageId: options.messageId },
            "Rich Markdown unavailable or invalid; falling back to a classic edit"
          );
        }
      }

      const msg = await withFloodRetry(
        () =>
          gramJsClient.editMessage(peer, {
            message: options.messageId,
            text: markdownToTelegramHtml(options.text),
            parseMode: "html",
            linkPreview: false,
            buttons,
          }),
        undefined,
        undefined,
        options.chatId
      );

      return { id: msg.id, date: msg.date, chatId: options.chatId };
    } catch (error) {
      log.error({ err: error }, "Error editing message");
      throw error;
    }
  }

  async deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    try {
      const gramJsClient = this.client.getClient();
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
            revoke: true,
          })
        );
      }
      return true;
    } catch (error) {
      log.error({ err: error }, "Error deleting message");
      return false;
    }
  }

  async forwardMessage(
    fromChatId: string,
    toChatId: string,
    messageId: number
  ): Promise<SentMessage> {
    try {
      const gramJsClient = this.client.getClient();
      const result = await gramJsClient.invoke(
        new Api.messages.ForwardMessages({
          fromPeer: fromChatId,
          toPeer: toChatId,
          id: [messageId],
          randomId: [randomLong()],
        })
      );

      let fwdMsg: Api.Message | undefined;
      if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
        for (const update of result.updates) {
          if (
            update instanceof Api.UpdateNewMessage ||
            update instanceof Api.UpdateNewChannelMessage
          ) {
            if (update.message instanceof Api.Message) {
              fwdMsg = update.message;
              break;
            }
          }
        }
      }

      if (fwdMsg) {
        return { id: fwdMsg.id, date: fwdMsg.date, chatId: toChatId };
      }
      return { id: 0, date: Math.floor(Date.now() / 1000), chatId: toChatId };
    } catch (error) {
      log.error({ err: error }, "Error forwarding message");
      throw error;
    }
  }

  async sendPhoto(
    chatId: string,
    photo: string | Buffer,
    caption?: string,
    replyToId?: number
  ): Promise<SentMessage> {
    try {
      const gramJsClient = this.client.getClient();
      const result = await gramJsClient.sendFile(chatId, {
        file: photo,
        caption,
        replyTo: replyToId,
        forceDocument: false,
      });
      return { id: result.id, date: result.date, chatId };
    } catch (error) {
      log.error({ err: error }, "Error sending photo");
      throw error;
    }
  }

  async setTyping(chatId: string): Promise<void> {
    try {
      await this.client.setTyping(chatId);
    } catch (error) {
      log.error({ err: error }, "Error setting typing");
    }
  }

  async sendReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      const peer = this.peerCache.get(chatId) || chatId;

      await withFloodRetry(
        () =>
          this.client.getClient().invoke(
            new Api.messages.SendReaction({
              peer,
              msgId: messageId,
              reaction: [
                new Api.ReactionEmoji({
                  emoticon: emoji,
                }),
              ],
            })
          ),
        undefined,
        undefined,
        chatId
      );
    } catch (error) {
      log.error({ err: error }, "Error sending reaction");
      throw error;
    }
  }

  async pinMessage(chatId: string, messageId: number): Promise<boolean> {
    try {
      const gramJsClient = this.client.getClient();
      await gramJsClient.invoke(
        new Api.messages.UpdatePinnedMessage({
          peer: chatId,
          id: messageId,
        })
      );
      return true;
    } catch (error) {
      log.error({ err: error }, "Error pinning message");
      return false;
    }
  }

  async sendDice(chatId: string, emoji?: string): Promise<SentDiceMessage> {
    try {
      const gramJsClient = this.client.getClient();
      const message = await gramJsClient.sendFile(chatId, {
        file: new Api.InputMediaDice({ emoticon: emoji ?? "🎲" }),
      });
      const dice = message.dice;
      if (!dice) {
        throw new Error("Telegram returned a dice message without a result");
      }

      return {
        id: message.id,
        date: message.date,
        chatId,
        value: dice.value,
      };
    } catch (error) {
      log.error({ err: error }, "Error sending dice");
      throw error;
    }
  }

  async getChatInfo(chatId: string): Promise<ChatInfo> {
    const gramJsClient = this.client.getClient();
    const entity = await gramJsClient.getEntity(chatId);

    if (entity instanceof Api.User) {
      return {
        id: chatId,
        title: [entity.firstName, entity.lastName].filter(Boolean).join(" ") || undefined,
        type: "private",
        username: entity.username,
      };
    }

    if (entity instanceof Api.Channel) {
      const isSupergroup = entity.megagroup ?? false;
      return {
        id: chatId,
        title: entity.title,
        type: isSupergroup ? "supergroup" : "channel",
        memberCount: entity.participantsCount ?? undefined,
        username: entity.username,
      };
    }

    if (entity instanceof Api.Chat) {
      return {
        id: chatId,
        title: entity.title,
        type: "group",
        memberCount: entity.participantsCount ?? undefined,
      };
    }

    return { id: chatId, type: "private" };
  }

  onNewMessage(
    handler: (message: TelegramMessage) => void | Promise<void>,
    filters?: {
      incoming?: boolean;
      outgoing?: boolean;
      chats?: string[];
    }
  ): void {
    this.client.addNewMessageHandler(
      async (event: NewMessageEvent) => {
        const message = await this.parseMessage(event.message);
        await handler(message);
      },
      {
        incoming: filters?.incoming,
        outgoing: filters?.outgoing,
        chats: filters?.chats,
      }
    );
  }

  async fetchReplyContext(rawMsg: unknown): Promise<ReplyContext | null> {
    try {
      const msg = rawMsg as Api.Message;
      const replyMsg = await Promise.race([
        msg.getReplyMessage(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
      ]);
      if (!replyMsg) return null;

      let senderName: string | undefined;
      try {
        const sender = await Promise.race([
          replyMsg.getSender(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
        ]);
        if (sender && "firstName" in sender) {
          senderName = (sender.firstName as string) ?? undefined;
        }
        if (sender && "username" in sender && !senderName) {
          senderName = (sender.username as string) ?? undefined;
        }
      } catch {
        // Non-critical
      }

      const replyMsgSenderId = replyMsg.senderId ? BigInt(replyMsg.senderId.toString()) : undefined;
      const isAgent = this.ownUserId !== undefined && replyMsgSenderId === this.ownUserId;
      const text = await resolveTelegramMessageText(
        this.client.getClient(),
        replyMsg,
        replyMsg.peerId
      );

      return {
        text: text || undefined,
        senderName,
        isAgent,
      };
    } catch {
      return null;
    }
  }

  getPeer(chatId: string): Api.TypePeer | undefined {
    return this.peerCache.get(chatId);
  }

  // --- Non-interface methods (user-bridge specific) ---

  /** The GramJS client wrapper. Reach it through the isUserBridge type guard. */
  getClient(): TelegramUserClient {
    return this.client;
  }

  async getDialogs(): Promise<
    Array<{
      id: string;
      title: string;
      isGroup: boolean;
      isChannel: boolean;
    }>
  > {
    try {
      const dialogs = await this.client.getDialogs();
      return dialogs.map((d) => ({
        id: d.id.toString(),
        title: d.title,
        isGroup: d.isGroup,
        isChannel: d.isChannel,
      }));
    } catch (error) {
      log.error({ err: error }, "Error getting dialogs");
      return [];
    }
  }

  onServiceMessage(handler: (message: TelegramMessage) => void | Promise<void>): void {
    this.client.addServiceMessageHandler(async (msg: Api.MessageService) => {
      const message = await this.parseServiceMessage(msg);
      if (message) {
        await handler(message);
      }
    });
  }

  /** Resolve sender username/firstName/bot flag with a timeout; non-fatal on failure. */
  private async resolveSender(
    msg: Api.Message | Api.MessageService
  ): Promise<{ senderUsername?: string; senderFirstName?: string; isBot: boolean }> {
    let senderUsername: string | undefined;
    let senderFirstName: string | undefined;
    let isBot = false;
    try {
      const sender = await Promise.race([
        msg.getSender(),
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), SENDER_RESOLVE_TIMEOUT_MS)
        ),
      ]);
      if (sender && "username" in sender) {
        senderUsername = sender.username ?? undefined;
      }
      if (sender && "firstName" in sender) {
        senderFirstName = sender.firstName ?? undefined;
      }
      if (sender instanceof Api.User) {
        isBot = sender.bot ?? false;
      }
    } catch {
      // getSender() can fail on deleted accounts, timeouts, etc. — non-critical
    }
    return { senderUsername, senderFirstName, isBot };
  }

  private async parseMessage(msg: Api.Message): Promise<TelegramMessage> {
    const chatId = msg.chatId?.toString() ?? msg.peerId?.toString() ?? "unknown";
    const senderIdBig = msg.senderId ? BigInt(msg.senderId.toString()) : BigInt(0);
    const senderId = Number(senderIdBig);
    const resolvedContent = await resolveTelegramMessageContent(
      this.client.getClient(),
      msg,
      msg.peerId
    );
    let { text } = resolvedContent;

    let mentionsMe = msg.mentioned ?? false;
    if (!mentionsMe && this.ownUsername && text) {
      mentionsMe = text.toLowerCase().includes(`@${this.ownUsername}`);
    }

    const isChannel = msg.post ?? false;
    const isGroup = !isChannel && chatId.startsWith("-");

    if (msg.peerId) this.cachePeer(chatId, msg.peerId);

    const { senderUsername, senderFirstName, isBot } = await this.resolveSender(msg);

    let { hasMedia, mediaType } = classifyMedia({
      photo: msg.photo,
      video: msg.video,
      audio: msg.audio,
      voice: msg.voice,
      sticker: msg.sticker,
      document: msg.document,
    });
    const richMessageMediaType = resolvedContent.richMessage
      ? classifyRichMessageMedia(resolvedContent.richMessage)
      : undefined;
    if (!hasMedia && richMessageMediaType) {
      hasMedia = true;
      mediaType = richMessageMediaType;
    }

    const replyToMsgId = msg.replyToMsgId;

    if (!text && msg.dice) {
      text = `[Dice: ${msg.dice.emoticon} = ${msg.dice.value}]`;
    } else if (!text && msg.media) {
      if (msg.media.className === "MessageMediaGame") {
        const game = msg.media as Api.MessageMediaGame;
        text = `[Game: ${game.game.title}]`;
      } else if (msg.media.className === "MessageMediaPoll") {
        const poll = msg.media as Api.MessageMediaPoll;
        text = `[Poll: ${poll.poll.question.text}]`;
      } else if (msg.media.className === "MessageMediaContact") {
        const contact = msg.media as Api.MessageMediaContact;
        text = `[Contact: ${contact.firstName} ${contact.lastName || ""} - ${contact.phoneNumber}]`;
      } else if (
        msg.media.className === "MessageMediaGeo" ||
        msg.media.className === "MessageMediaGeoLive"
      ) {
        text = `[Location shared]`;
      }
    }

    const senderRank = (msg as unknown as { fromRank?: string }).fromRank || undefined;

    return {
      id: msg.id,
      chatId,
      senderId,
      senderUsername,
      senderFirstName,
      senderRank,
      text,
      isGroup,
      isChannel,
      isBot,
      mentionsMe,
      timestamp: new Date(msg.date * 1000),
      _rawPeer: msg.peerId,
      hasMedia,
      mediaType,
      replyToId: replyToMsgId,
      _rawMessage: hasMedia || !!replyToMsgId ? msg : undefined,
    };
  }

  private async parseServiceMessage(msg: Api.MessageService): Promise<TelegramMessage | null> {
    const action = msg.action;
    if (!action) return null;

    const isGiftAction =
      action instanceof Api.MessageActionStarGiftPurchaseOffer ||
      action instanceof Api.MessageActionStarGiftPurchaseOfferDeclined ||
      action instanceof Api.MessageActionStarGift;
    if (!isGiftAction) return null;

    if (msg.out) return null;

    const chatId = msg.chatId?.toString() ?? msg.peerId?.toString() ?? "unknown";
    const senderIdBig = msg.senderId ? BigInt(msg.senderId.toString()) : BigInt(0);
    const senderId = Number(senderIdBig);

    const { senderUsername, senderFirstName, isBot } = await this.resolveSender(msg);

    let text = "";

    if (action instanceof Api.MessageActionStarGiftPurchaseOffer) {
      const gift = action.gift;
      const isUnique = gift instanceof Api.StarGiftUnique;
      const title = gift.title || "Unknown Gift";
      const slug = isUnique ? gift.slug : undefined;
      const num = isUnique ? gift.num : undefined;
      const priceStars = action.price.amount?.toString() || "?";
      const status = action.accepted ? "accepted" : action.declined ? "declined" : "pending";
      const expires = action.expiresAt
        ? new Date(action.expiresAt * 1000).toISOString()
        : "unknown";

      text = `[Gift Offer Received]\n`;
      text += `Offer: ${priceStars} Stars for your NFT "${title}"${num ? ` #${num}` : ""}${slug ? ` (slug: ${slug})` : ""}\n`;
      text += `From: ${senderUsername ? `@${senderUsername}` : senderFirstName || `user:${senderId}`}\n`;
      text += `Expires: ${expires}\n`;
      text += `Status: ${status}\n`;
      text += `Message ID: ${msg.id} — use telegram_resolve_gift_offer(offerMsgId=${msg.id}) to accept or telegram_resolve_gift_offer(offerMsgId=${msg.id}, decline=true) to decline.`;

      log.info(
        `Gift offer received: ${priceStars} Stars for "${title}" from ${senderUsername || senderId}`
      );
    } else if (action instanceof Api.MessageActionStarGiftPurchaseOfferDeclined) {
      const gift = action.gift;
      const isUnique = gift instanceof Api.StarGiftUnique;
      const title = gift.title || "Unknown Gift";
      const slug = isUnique ? gift.slug : undefined;
      const num = isUnique ? gift.num : undefined;
      const priceStars = action.price.amount?.toString() || "?";
      const reason = action.expired ? "expired" : "declined";

      text = `[Gift Offer ${action.expired ? "Expired" : "Declined"}]\n`;
      text += `Your offer of ${priceStars} Stars for NFT "${title}"${num ? ` #${num}` : ""}${slug ? ` (slug: ${slug})` : ""} was ${reason}.`;

      log.info(`Gift offer ${reason}: ${priceStars} Stars for "${title}"`);
    } else if (action instanceof Api.MessageActionStarGift) {
      const gift = action.gift;
      const title = gift.title || "Unknown Gift";
      const stars = gift instanceof Api.StarGift ? gift.stars?.toString() || "?" : "?";
      const giftMessage = action.message?.text || "";
      const fromAnonymous = action.nameHidden;

      text = `[Gift Received]\n`;
      text += `Gift: "${title}" (${stars} Stars)${action.upgraded ? " [Upgraded to Collectible]" : ""}\n`;
      text += `From: ${fromAnonymous ? "Anonymous" : senderUsername ? `@${senderUsername}` : senderFirstName || `user:${senderId}`}\n`;
      if (giftMessage) text += `Message: "${giftMessage}"\n`;
      if (action.canUpgrade && action.upgradeStars) {
        text += `This gift can be upgraded to a collectible for ${action.upgradeStars.toString()} Stars.\n`;
      }
      if (action.convertStars) {
        text += `Can be converted to ${action.convertStars.toString()} Stars.`;
      }

      log.info(
        `Gift received: "${title}" (${stars} Stars) from ${fromAnonymous ? "Anonymous" : senderUsername || senderId}`
      );
    }

    if (!text) return null;

    if (msg.peerId) this.cachePeer(chatId, msg.peerId);

    return {
      id: msg.id,
      chatId,
      senderId,
      senderUsername,
      senderFirstName,
      text: text.trim(),
      isGroup: false,
      isChannel: false,
      isBot,
      mentionsMe: true,
      timestamp: new Date(msg.date * 1000),
      hasMedia: false,
      _rawPeer: msg.peerId,
    };
  }
}
