import { TelegramUserClient, type TelegramClientConfig } from "../client.js";
import { Api } from "telegram";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { createLogger } from "../../utils/logger.js";
import { withFloodRetry } from "../flood-retry.js";
import { randomLong } from "../../utils/gramjs-bigint.js";
import { classifyMedia } from "../bridge-interface.js";
import type {
  ITelegramBridge,
  TelegramMessage,
  InlineButton, // eslint-disable-line @typescript-eslint/no-unused-vars -- re-exported for backward compat
  SendMessageOptions,
  SentMessage,
  EditMessageOptions,
  ReplyContext,
  BotInfo,
  ChatInfo,
} from "../bridge-interface.js";

export type { TelegramMessage, InlineButton, SendMessageOptions } from "../bridge-interface.js";

const log = createLogger("Telegram");

/** Max time to wait for getSender() before giving up (deleted accounts, timeouts). */
const SENDER_RESOLVE_TIMEOUT_MS = 5000;

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

      let msg: Api.Message;

      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        const buttons = this.buildInlineMarkup(options.inlineKeyboard);

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
          new Api.KeyboardButtonRow({
            buttons: row.map(
              (btn) =>
                new Api.KeyboardButtonCallback({
                  text: btn.text,
                  data: Buffer.from(btn.callback_data),
                })
            ),
          })
      ),
    });
  }

  async editMessage(options: EditMessageOptions): Promise<SentMessage> {
    try {
      const peer = this.peerCache.get(options.chatId) || options.chatId;

      let buttons: Api.ReplyInlineMarkup | undefined;
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        buttons = this.buildInlineMarkup(options.inlineKeyboard);
      }

      const gramJsClient = this.client.getClient();
      const result = await withFloodRetry(
        () =>
          gramJsClient.invoke(
            new Api.messages.EditMessage({
              peer,
              id: options.messageId,
              message: options.text,
              replyMarkup: buttons,
            })
          ),
        undefined,
        undefined,
        options.chatId
      );

      let msg: Api.Message | undefined;
      if (result instanceof Api.Updates) {
        const messageUpdate = result.updates.find(
          (u) => u.className === "UpdateEditMessage" || u.className === "UpdateEditChannelMessage"
        );
        if (messageUpdate && "message" in messageUpdate) {
          msg = messageUpdate.message as Api.Message;
        }
      }

      if (msg) {
        return { id: msg.id, date: msg.date, chatId: options.chatId };
      }
      return { id: options.messageId, date: Math.floor(Date.now() / 1000), chatId: options.chatId };
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

  async sendDice(chatId: string, emoji?: string): Promise<SentMessage> {
    try {
      const gramJsClient = this.client.getClient();
      const result = await gramJsClient.invoke(
        new Api.messages.SendMedia({
          peer: chatId,
          media: new Api.InputMediaDice({ emoticon: emoji ?? "🎲" }),
          message: "",
          randomId: randomLong(),
        })
      );

      if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
        for (const update of result.updates) {
          if (
            update instanceof Api.UpdateNewMessage ||
            update instanceof Api.UpdateNewChannelMessage
          ) {
            const msg = update.message;
            if (msg instanceof Api.Message) {
              return { id: msg.id, date: msg.date, chatId };
            }
          }
        }
      }

      return { id: 0, date: Math.floor(Date.now() / 1000), chatId };
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

      return {
        text: replyMsg.message || undefined,
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

    let mentionsMe = msg.mentioned ?? false;
    if (!mentionsMe && this.ownUsername && msg.message) {
      mentionsMe = msg.message.toLowerCase().includes(`@${this.ownUsername}`);
    }

    const isChannel = msg.post ?? false;
    const isGroup = !isChannel && chatId.startsWith("-");

    if (msg.peerId) this.cachePeer(chatId, msg.peerId);

    const { senderUsername, senderFirstName, isBot } = await this.resolveSender(msg);

    const { hasMedia, mediaType } = classifyMedia({
      photo: msg.photo,
      video: msg.video,
      audio: msg.audio,
      voice: msg.voice,
      sticker: msg.sticker,
      document: msg.document,
    });

    const replyToMsgId = msg.replyToMsgId;

    let text = msg.message ?? "";
    if (!text && msg.media) {
      if (msg.media.className === "MessageMediaDice") {
        const dice = msg.media as Api.MessageMediaDice;
        text = `[Dice: ${dice.emoticon} = ${dice.value}]`;
      } else if (msg.media.className === "MessageMediaGame") {
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
