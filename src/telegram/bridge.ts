/**
 * Bridge between Tonnet and Telegram using GramJS
 * Replaces MCP-based implementation with real TelegramClient
 */

import { TelegramUserClient, type TelegramClientConfig } from "./client.js";
import { Api } from "telegram";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";

export interface TelegramMessage {
  id: number;
  chatId: string;
  senderId: number;
  senderUsername?: string;
  senderFirstName?: string;
  text: string;
  isGroup: boolean;
  isChannel: boolean;
  isBot: boolean; // Whether sender is a bot
  mentionsMe: boolean;
  timestamp: Date;
  _rawPeer?: Api.TypePeer; // Store raw peer for replying
  // Media fields
  hasMedia: boolean;
  mediaType?: "photo" | "document" | "video" | "audio" | "voice" | "sticker";
  _rawMessage?: Api.Message; // Store raw message for media download
}

export interface InlineButton {
  text: string;
  callback_data: string; // Max 64 bytes
}

export interface SendMessageOptions {
  chatId: string;
  text: string;
  replyToId?: number;
  inlineKeyboard?: InlineButton[][]; // 2D array: rows of buttons
}

/**
 * Bridge class wrapping TelegramUserClient
 */
export class TelegramBridge {
  private client: TelegramUserClient;
  private ownUserId?: bigint;
  private peerCache: Map<string, Api.TypePeer> = new Map();

  constructor(config: TelegramClientConfig) {
    this.client = new TelegramUserClient(config);
  }

  /**
   * Connect and authenticate
   */
  async connect(): Promise<void> {
    await this.client.connect();
    const me = this.client.getMe();
    if (me) {
      this.ownUserId = me.id;
    }

    // Load dialogs to cache entities for sending messages
    // This is required for GramJS to resolve user/chat entities
    try {
      await this.getDialogs();
    } catch (error) {
      console.warn("⚠️ Could not load dialogs:", error);
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Check if bridge is available (connected)
   */
  isAvailable(): boolean {
    return this.client.isConnected();
  }

  /**
   * Get own user ID
   */
  getOwnUserId(): bigint | undefined {
    return this.ownUserId;
  }

  /**
   * Get own username
   */
  getUsername(): string | undefined {
    const me = this.client.getMe();
    return me?.username;
  }

  /**
   * Get recent messages from a chat
   */
  async getMessages(chatId: string, limit: number = 50): Promise<TelegramMessage[]> {
    try {
      const messages = await this.client.getMessages(chatId, { limit });
      return await Promise.all(messages.map((msg) => this.parseMessage(msg)));
    } catch (error) {
      console.error("Error getting messages:", error);
      return [];
    }
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(
    options: SendMessageOptions & { _rawPeer?: Api.TypePeer }
  ): Promise<Api.Message> {
    try {
      // Use cached peer if available, otherwise use chatId
      const peer = options._rawPeer || this.peerCache.get(options.chatId) || options.chatId;

      // Build inline keyboard if provided
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        const buttons = new Api.ReplyInlineMarkup({
          rows: options.inlineKeyboard.map(
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

        // Use GramJS client directly for inline keyboards
        const gramJsClient = this.client.getClient();
        return await gramJsClient.sendMessage(peer, {
          message: options.text,
          replyTo: options.replyToId,
          buttons,
        });
      }

      // Regular message without buttons
      return await this.client.sendMessage(peer, {
        message: options.text,
        replyTo: options.replyToId,
      });
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(options: {
    chatId: string;
    messageId: number;
    text: string;
    inlineKeyboard?: InlineButton[][];
  }): Promise<Api.Message> {
    try {
      const peer = this.peerCache.get(options.chatId) || options.chatId;

      // Build inline keyboard if provided
      let buttons;
      if (options.inlineKeyboard && options.inlineKeyboard.length > 0) {
        buttons = new Api.ReplyInlineMarkup({
          rows: options.inlineKeyboard.map(
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

      const gramJsClient = this.client.getClient();
      const result: any = await gramJsClient.invoke(
        new Api.messages.EditMessage({
          peer,
          id: options.messageId,
          message: options.text,
          replyMarkup: buttons,
        })
      );

      // Extract message from Updates
      if (result.className === "Updates" && result.updates) {
        const messageUpdate = result.updates.find(
          (u: any) =>
            u.className === "UpdateEditMessage" || u.className === "UpdateEditChannelMessage"
        );
        if (messageUpdate?.message) {
          return messageUpdate.message;
        }
      }

      return result;
    } catch (error) {
      console.error("Error editing message:", error);
      throw error;
    }
  }

  /**
   * Get list of dialogs (chats)
   */
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
      console.error("Error getting dialogs:", error);
      return [];
    }
  }

  /**
   * Set typing indicator
   */
  async setTyping(chatId: string): Promise<void> {
    try {
      await this.client.setTyping(chatId);
    } catch (error) {
      console.error("Error setting typing:", error);
    }
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    try {
      // Get peer from cache or use chatId directly
      const peer = this.peerCache.get(chatId) || chatId;

      // Send reaction using sendReaction API
      await this.client.getClient().invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: messageId,
          reaction: [
            new Api.ReactionEmoji({
              emoticon: emoji,
            }),
          ],
        })
      );
    } catch (error) {
      console.error("Error sending reaction:", error);
      throw error;
    }
  }

  /**
   * Register event handler for new messages
   */
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

  /**
   * Parse GramJS message to TelegramMessage
   * Fetches sender info (username, firstName) from the message
   */
  private async parseMessage(msg: Api.Message): Promise<TelegramMessage> {
    const chatId = msg.chatId?.toString() ?? msg.peerId?.toString() ?? "unknown";
    const senderIdBig = msg.senderId ? BigInt(msg.senderId.toString()) : BigInt(0);
    const senderId = Number(senderIdBig);

    // Check if message mentions us
    const mentionsMe = msg.mentioned ?? false;

    // Determine chat type
    const isChannel = msg.post ?? false;
    const isGroup = !isChannel && chatId.startsWith("-");

    // Cache the peer for replying later
    if (msg.peerId) {
      this.peerCache.set(chatId, msg.peerId);
    }

    // Fetch sender info
    let senderUsername: string | undefined;
    let senderFirstName: string | undefined;
    let isBot = false;
    try {
      const sender = await Promise.race([
        msg.getSender(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
      ]);
      if (sender && "username" in sender) {
        senderUsername = sender.username ?? undefined;
      }
      if (sender && "firstName" in sender) {
        senderFirstName = sender.firstName ?? undefined;
      }
      // Check if sender is a bot
      if (sender && "bot" in sender) {
        isBot = (sender as any).bot ?? false;
      }
    } catch (e) {
      // Sender fetch failed or timed out, continue without sender info
    }

    // Detect media type
    const hasMedia = !!(
      msg.photo ||
      msg.document ||
      msg.video ||
      msg.audio ||
      msg.voice ||
      msg.sticker
    );
    let mediaType: TelegramMessage["mediaType"];
    if (msg.photo) mediaType = "photo";
    else if (msg.video) mediaType = "video";
    else if (msg.audio) mediaType = "audio";
    else if (msg.voice) mediaType = "voice";
    else if (msg.sticker) mediaType = "sticker";
    else if (msg.document) mediaType = "document";

    // Extract text - handle dice/game media specially
    let text = msg.message ?? "";
    if (!text && msg.media) {
      // Check for dice (🎲, 🎯, 🏀, ⚽, 🎳, 🎰)
      if (msg.media.className === "MessageMediaDice") {
        const dice = msg.media as Api.MessageMediaDice;
        text = `[Dice: ${dice.emoticon} = ${dice.value}]`;
      }
      // Check for game
      else if (msg.media.className === "MessageMediaGame") {
        const game = msg.media as Api.MessageMediaGame;
        text = `[Game: ${game.game.title}]`;
      }
      // Check for poll
      else if (msg.media.className === "MessageMediaPoll") {
        const poll = msg.media as Api.MessageMediaPoll;
        text = `[Poll: ${poll.poll.question.text}]`;
      }
      // Check for contact
      else if (msg.media.className === "MessageMediaContact") {
        const contact = msg.media as Api.MessageMediaContact;
        text = `[Contact: ${contact.firstName} ${contact.lastName || ""} - ${contact.phoneNumber}]`;
      }
      // Check for location
      else if (
        msg.media.className === "MessageMediaGeo" ||
        msg.media.className === "MessageMediaGeoLive"
      ) {
        text = `[Location shared]`;
      }
    }

    return {
      id: msg.id,
      chatId,
      senderId,
      senderUsername,
      senderFirstName,
      text,
      isGroup,
      isChannel,
      isBot,
      mentionsMe,
      timestamp: new Date(msg.date * 1000),
      _rawPeer: msg.peerId,
      hasMedia,
      mediaType,
      _rawMessage: hasMedia ? msg : undefined, // Store raw message only if has media (for download)
    };
  }

  /**
   * Get the underlying client
   */
  getClient(): TelegramUserClient {
    return this.client;
  }
}
