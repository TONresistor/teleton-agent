/* eslint-disable @typescript-eslint/no-explicit-any */
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { markdownToTelegramHtml } from "../formatting.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../constants/limits.js";
import type {
  ITelegramBridge,
  SentMessage,
  SendMessageOptions,
  EditMessageOptions,
  BotInfo,
  ChatInfo,
  ReplyContext,
} from "../bridge-interface.js";
import type { TelegramMessage, InlineButton } from "../bridge.js";
import { createLogger } from "../../utils/logger.js";
import { callbackRouter } from "../../bot/callback-router.js";

const log = createLogger("BotBridge");

interface GrammyBotBridgeConfig {
  bot_token: string;
}

type GrammyMessage = NonNullable<Context["message"]>;

export class GrammyBotBridge implements ITelegramBridge {
  private bot: Bot;
  private botInfo: BotInfo | undefined;
  private connected = false;
  private botPromise: Promise<void> | undefined;
  private callbackHandler: ((msg: TelegramMessage) => void) | undefined;
  private activeDraftIds: Map<string, number> = new Map();

  constructor(config: GrammyBotBridgeConfig) {
    this.bot = new Bot(config.bot_token);

    this.bot.catch((err) => {
      log.error({ err }, "Grammy bot error");
    });
  }

  async connect(): Promise<void> {
    // Only init (fetch bot info) — polling starts after handlers are registered via startPolling()
    await this.bot.init();
    const me = this.bot.botInfo;
    this.botInfo = {
      id: me.id,
      username: me.username,
      firstName: me.first_name,
      isBot: me.is_bot,
    };
    this.connected = true;
    log.info("Grammy bot initialized (polling deferred until handlers registered)");
  }

  /** Start long-polling. Must be called AFTER onNewMessage() to avoid Grammy listener error. */
  startPolling(): void {
    this.botPromise = this.bot
      .start({
        drop_pending_updates: true,
        onStart: () => {
          log.info("Grammy bot polling started");
        },
      })
      .catch((err) => {
        log.error({ err }, "Grammy bot polling error");
      });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.bot.stop();
  }

  getMode(): "bot" {
    return "bot";
  }

  isAvailable(): boolean {
    return this.connected;
  }

  getOwnUserId(): bigint | undefined {
    return this.botInfo ? BigInt(this.botInfo.id) : undefined;
  }

  getUsername(): string | undefined {
    return this.botInfo?.username;
  }

  async sendMessage(options: SendMessageOptions): Promise<SentMessage> {
    if (!options.text || options.text.trim().length === 0) {
      log.debug("sendMessage skipped: empty text");
      return { id: 0, date: Math.floor(Date.now() / 1000), chatId: options.chatId };
    }

    const replyMarkup = options.inlineKeyboard?.length
      ? this.toGrammyKeyboard(options.inlineKeyboard)
      : undefined;

    const html = markdownToTelegramHtml(options.text);

    // Auto-split: if HTML exceeds Telegram limit, send in chunks
    if (html.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      return this.sendLongMessage(options.chatId, html, options.replyToId, replyMarkup);
    }

    const result = await this.bot.api.sendMessage(Number(options.chatId), html, {
      parse_mode: "HTML",
      reply_to_message_id: options.replyToId,
      reply_markup: replyMarkup,
    });

    return {
      id: result.message_id,
      date: result.date,
      chatId: options.chatId,
    };
  }

  /** Split and send HTML that exceeds the Telegram message limit */
  private async sendLongMessage(
    chatId: string,
    html: string,
    replyToId?: number,
    replyMarkup?: InlineKeyboard
  ): Promise<SentMessage> {
    const chunks: string[] = [];
    let remaining = html;

    while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      // Find a split point: prefer double newline, then single newline, then space
      let splitAt = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_MESSAGE_LENGTH);
      if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH * 0.3) {
        splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE_LENGTH);
      }
      if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH * 0.3) {
        splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_MESSAGE_LENGTH);
      }
      if (splitAt < TELEGRAM_MAX_MESSAGE_LENGTH * 0.3) {
        splitAt = TELEGRAM_MAX_MESSAGE_LENGTH; // hard cut as last resort
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);

    let lastResult: SentMessage = { id: 0, date: Math.floor(Date.now() / 1000), chatId };

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const result = await this.bot.api.sendMessage(Number(chatId), chunks[i], {
        parse_mode: "HTML",
        reply_to_message_id: isFirst ? replyToId : undefined,
        reply_markup: isLast ? replyMarkup : undefined,
      });
      lastResult = { id: result.message_id, date: result.date, chatId };
    }

    return lastResult;
  }

  async editMessage(options: EditMessageOptions): Promise<SentMessage> {
    const replyMarkup = options.inlineKeyboard?.length
      ? this.toGrammyKeyboard(options.inlineKeyboard)
      : undefined;

    const result = await this.bot.api.editMessageText(
      Number(options.chatId),
      options.messageId,
      markdownToTelegramHtml(options.text),
      { parse_mode: "HTML", reply_markup: replyMarkup }
    );

    if (typeof result === "boolean") {
      return { id: options.messageId, date: Math.floor(Date.now() / 1000), chatId: options.chatId };
    }

    return {
      id: result.message_id,
      date: result.date,
      chatId: options.chatId,
    };
  }

  async deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    await this.bot.api.deleteMessage(Number(chatId), messageId);
    return true;
  }

  async forwardMessage(
    fromChatId: string,
    toChatId: string,
    messageId: number
  ): Promise<SentMessage> {
    const result = await this.bot.api.forwardMessage(
      Number(toChatId),
      Number(fromChatId),
      messageId
    );

    return {
      id: result.message_id,
      date: result.date,
      chatId: toChatId,
    };
  }

  async sendPhoto(
    chatId: string,
    photo: string | Buffer,
    caption?: string,
    replyToId?: number
  ): Promise<SentMessage> {
    const input = Buffer.isBuffer(photo) ? new InputFile(photo) : photo;
    const result = await this.bot.api.sendPhoto(Number(chatId), input, {
      caption,
      reply_to_message_id: replyToId,
    });

    return {
      id: result.message_id,
      date: result.date,
      chatId,
    };
  }

  async pinMessage(chatId: string, messageId: number): Promise<boolean> {
    await this.bot.api.pinChatMessage(Number(chatId), messageId);
    return true;
  }

  async sendDice(chatId: string, emoji?: string): Promise<SentMessage> {
    const result = await this.bot.api.sendDice(
      Number(chatId),
      emoji as Parameters<typeof this.bot.api.sendDice>[1]
    );

    return {
      id: result.message_id,
      date: result.date,
      chatId,
    };
  }

  async getChatInfo(chatId: string): Promise<ChatInfo> {
    const chat = await this.bot.api.getChat(Number(chatId));

    return {
      id: String(chat.id),
      title: "title" in chat ? chat.title : undefined,
      type: chat.type as ChatInfo["type"],
      memberCount: undefined,
      description: "description" in chat ? chat.description : undefined,
      username: "username" in chat ? chat.username : undefined,
    };
  }

  async getMe(): Promise<BotInfo | undefined> {
    const me = await this.bot.api.getMe();

    return {
      id: me.id,
      username: me.username,
      firstName: me.first_name,
      isBot: me.is_bot,
    };
  }

  async setTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(Number(chatId), "typing");
    } catch {
      // 429 rate-limits on typing are harmless — swallow silently
    }
  }

  async sendReaction(chatId: string, messageId: number, emoji: string): Promise<void> {
    await this.bot.api.setMessageReaction(Number(chatId), messageId, [
      { type: "emoji", emoji } as Parameters<
        typeof this.bot.api.setMessageReaction
      >[2] extends (infer U)[]
        ? U
        : never,
    ]);
  }

  /**
   * Stream text to chat via sendMessageDraft. Does NOT send a final message —
   * the caller decides when to finalize (after all tool iterations complete).
   * When accumulated text approaches the Telegram message limit, the current
   * draft is flushed as a real message and streaming continues in a new draft.
   * Returns only the un-sent remainder (what finalizeDraft should send).
   */
  async streamDraft(chatId: string, textStream: AsyncIterable<string>): Promise<string> {
    let draftId = this.activeDraftIds.get(chatId) ?? Math.floor(Math.random() * 2147483647) + 1;
    this.activeDraftIds.set(chatId, draftId);
    let fullText = "";
    let lastDraftTime = 0;
    const THROTTLE_MS = 300;
    const numericChatId = Number(chatId);
    // Leave headroom for HTML expansion from markdownToTelegramHtml
    const SPLIT_THRESHOLD = TELEGRAM_MAX_MESSAGE_LENGTH - 300;

    for await (const chunk of textStream) {
      fullText += chunk;
      // Don't stream silent tokens or heartbeat tokens as visible drafts
      if (fullText.trim() === "__SILENT__" || fullText.trim() === "NO_ACTION") continue;

      // Auto-split: when accumulated text nears the limit, flush as real message
      const html = markdownToTelegramHtml(fullText);
      if (html.length >= SPLIT_THRESHOLD) {
        // Clear draft bubble and send as real message
        try {
          await this.bot.api.sendMessageDraft(numericChatId, draftId, " ");
        } catch {
          /* best effort */
        }
        await this.sendMessage({ chatId, text: fullText });

        // Reset for next segment
        fullText = "";
        draftId = Math.floor(Math.random() * 2147483647) + 1;
        this.activeDraftIds.set(chatId, draftId);
        lastDraftTime = 0;
        continue;
      }

      const now = Date.now();
      if (now - lastDraftTime >= THROTTLE_MS && fullText.length > 0) {
        try {
          await this.bot.api.sendMessageDraft(numericChatId, draftId, html, { parse_mode: "HTML" });
        } catch {
          // Draft updates are best-effort
        }
        lastDraftTime = now;
      }
    }

    // Send one final draft update with complete text
    if (fullText.length > 0) {
      try {
        await this.bot.api.sendMessageDraft(
          numericChatId,
          draftId,
          markdownToTelegramHtml(fullText),
          { parse_mode: "HTML" }
        );
      } catch {
        /* best effort */
      }
    }

    return fullText;
  }

  async clearDraft(chatId: string): Promise<void> {
    const draftId = this.activeDraftIds.get(chatId);
    if (draftId) {
      try {
        await this.bot.api.sendMessageDraft(Number(chatId), draftId, " ");
      } catch {
        /* best effort */
      }
      this.activeDraftIds.delete(chatId);
    }
  }

  /** Clear active draft and send the final real message */
  async finalizeDraft(chatId: string, text: string): Promise<SentMessage> {
    await this.clearDraft(chatId);
    if (!text || text.trim().length === 0) {
      return { id: 0, date: Math.floor(Date.now() / 1000), chatId };
    }
    return this.sendMessage({ chatId, text });
  }

  resetDraft(chatId: string): void {
    this.activeDraftIds.delete(chatId);
  }

  /** Stream response: draft tokens then send final message. Convenience wrapper. */
  async streamResponse(chatId: string, textStream: AsyncIterable<string>): Promise<SentMessage> {
    const text = await this.streamDraft(chatId, textStream);
    return this.finalizeDraft(chatId, text);
  }

  async getMessages(_chatId: string, _limit: number): Promise<TelegramMessage[]> {
    return [];
  }

  parseMessage(msg: GrammyMessage): TelegramMessage {
    const botUsername = this.botInfo?.username?.toLowerCase();

    let mentionsMe = msg.chat.type === "private"; // DMs always count as "mentioning" the bot

    // Reply to bot's own message counts as mention
    if (msg.reply_to_message?.from?.id === this.botInfo?.id) {
      mentionsMe = true;
    }

    if (!mentionsMe && msg.entities && botUsername) {
      for (const entity of msg.entities) {
        if (entity.type === "mention") {
          const mentionText = (msg.text || "").slice(entity.offset, entity.offset + entity.length);
          if (mentionText.toLowerCase() === `@${botUsername}`) {
            mentionsMe = true;
            break;
          }
        } else if (entity.type === "bot_command") {
          mentionsMe = true;
          break;
        }
      }
    }

    // Also check text for @botUsername without entity (some clients)
    if (!mentionsMe && botUsername && (msg.text || "").toLowerCase().includes(`@${botUsername}`)) {
      mentionsMe = true;
    }

    const hasMedia = !!(
      msg.photo ||
      msg.voice ||
      msg.audio ||
      msg.document ||
      msg.video ||
      msg.sticker
    );

    let mediaType: TelegramMessage["mediaType"];
    if (msg.photo) mediaType = "photo";
    else if (msg.video) mediaType = "video";
    else if (msg.voice) mediaType = "voice";
    else if (msg.audio) mediaType = "audio";
    else if (msg.sticker) mediaType = "sticker";
    else if (msg.document) mediaType = "document";

    return {
      id: msg.message_id,
      chatId: String(msg.chat.id),
      senderId: msg.from?.id ?? 0,
      senderUsername: msg.from?.username,
      senderFirstName: msg.from?.first_name,
      text: msg.text || msg.caption || "",
      isGroup: msg.chat.type === "group" || msg.chat.type === "supergroup",
      isChannel: (msg.chat.type as string) === "channel",
      isBot: msg.from?.is_bot ?? false,
      mentionsMe,
      hasMedia,
      mediaType,
      timestamp: new Date(msg.date * 1000),
      replyToId: msg.reply_to_message?.message_id,
      _rawMessage: msg.reply_to_message ? (msg as any) : undefined,
    };
  }

  onNewMessage(
    handler: (msg: TelegramMessage) => void | Promise<void>,
    filters?: { incoming?: boolean; outgoing?: boolean; chats?: string[] }
  ): void {
    this.bot.on(
      [
        "message:text",
        "message:photo",
        "message:video",
        "message:voice",
        "message:document",
        "message:sticker",
      ],
      async (ctx) => {
        if (!ctx.message) return;

        const msg = this.parseMessage(ctx.message);

        // Bots only receive incoming messages; outgoing filter doesn't apply
        if (filters?.incoming === false) return;

        if (filters?.chats && !filters.chats.includes(msg.chatId)) return;

        try {
          await handler(msg);
        } catch (err) {
          log.error({ err }, "Error in message handler");
        }
      }
    );

    // Callback handler — resolves nonces from telegram_send_buttons, reinjects as synthetic messages
    this.bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery();

      const data = ctx.callbackQuery.data;
      if (data?.startsWith("btn:") && this.callbackHandler) {
        const from = ctx.callbackQuery.from;
        const chat = ctx.callbackQuery.message?.chat;
        if (chat) {
          const synthetic = callbackRouter.resolveCallback(
            data,
            from.id,
            from.username,
            from.first_name,
            String(chat.id),
            chat.type === "group" || chat.type === "supergroup"
          );
          if (synthetic) {
            this.callbackHandler(synthetic);
          }
        }
      }
    });
  }

  async fetchReplyContext(rawMsg: unknown): Promise<ReplyContext | null> {
    const msg = rawMsg as GrammyMessage | undefined;
    if (!msg?.reply_to_message) return null;

    const reply = msg.reply_to_message;

    const senderName = reply.from?.first_name || reply.from?.username || undefined;

    const isAgent = this.botInfo !== undefined && reply.from?.id === this.botInfo.id;

    return {
      text: reply.text || reply.caption || undefined,
      senderName,
      isAgent,
    };
  }

  getPeer(_chatId: string): undefined {
    return undefined;
  }

  getRawClient(): Bot {
    return this.bot;
  }

  /** Set callback handler for synthetic message injection (from CallbackRouter) */
  setCallbackHandler(handler: (msg: TelegramMessage) => void): void {
    this.callbackHandler = handler;
  }

  /** Sync admin commands to Telegram's slash-command menu via setMyCommands */
  async syncCommands(): Promise<void> {
    const commands = [
      { command: "status", description: "View agent status" },
      { command: "model", description: "Switch LLM model" },
      { command: "reasoning", description: "Set reasoning effort (off/low/medium/high)" },
      { command: "loop", description: "Set max agentic iterations" },
      { command: "policy", description: "Change access policy" },
      { command: "strategy", description: "View/change trading thresholds" },
      { command: "modules", description: "Manage module permissions" },
      { command: "plugin", description: "Manage plugin secrets" },
      { command: "wallet", description: "Check TON wallet balance" },
      { command: "verbose", description: "Toggle verbose logging" },
      { command: "rag", description: "Toggle Tool RAG or view status" },
      { command: "pause", description: "Pause the agent" },
      { command: "resume", description: "Resume the agent" },
      { command: "stop", description: "Emergency shutdown" },
      { command: "clear", description: "Clear conversation history" },
      { command: "ping", description: "Check if agent is responsive" },
      { command: "help", description: "Show available commands" },
    ];
    try {
      await this.bot.api.setMyCommands(commands);
      log.info(`Bot commands synced: ${commands.length} commands registered`);
    } catch (err) {
      log.warn({ err }, "Failed to sync bot commands");
    }
  }

  private toGrammyKeyboard(buttons: InlineButton[][]): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const row of buttons) {
      for (const btn of row) {
        kb.text(btn.text, btn.callback_data);
      }
      kb.row();
    }
    return kb;
  }
}
