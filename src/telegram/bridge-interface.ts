import type { Api } from "telegram";

export interface TelegramMessage {
  id: number;
  chatId: string;
  senderId: number;
  senderUsername?: string;
  senderFirstName?: string;
  senderRank?: string;
  text: string;
  isGroup: boolean;
  isChannel: boolean;
  isBot: boolean;
  mentionsMe: boolean;
  timestamp: Date;
  _rawPeer?: Api.TypePeer;
  hasMedia: boolean;
  mediaType?: "photo" | "document" | "video" | "audio" | "voice" | "sticker";
  replyToId?: number;
  _rawMessage?: Api.Message;
}

type MediaType = NonNullable<TelegramMessage["mediaType"]>;

/**
 * Classify a message's media from per-kind presence flags. Shared by both bridges
 * (GramJS user, grammy bot) which extract the flags from their own message shapes.
 * A message carries at most one media kind, so the check order is arbitrary.
 */
export function classifyMedia(present: Record<MediaType, unknown>): {
  hasMedia: boolean;
  mediaType?: MediaType;
} {
  const order: MediaType[] = ["photo", "video", "audio", "voice", "sticker", "document"];
  const mediaType = order.find((k) => present[k]);
  return { hasMedia: mediaType !== undefined, mediaType };
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface SendMessageOptions {
  chatId: string;
  text: string;
  replyToId?: number;
  inlineKeyboard?: InlineButton[][];
}

export interface SentMessage {
  id: number;
  date: number;
  chatId: string;
}

export interface EditMessageOptions {
  chatId: string;
  messageId: number;
  text: string;
  inlineKeyboard?: InlineButton[][];
}

export interface ReplyContext {
  text?: string;
  senderName?: string;
  isAgent?: boolean;
}

export interface BotInfo {
  id: number;
  username?: string;
  firstName: string;
  isBot: boolean;
}

export interface ChatInfo {
  id: string;
  title?: string;
  type: "private" | "group" | "supergroup" | "channel";
  memberCount?: number;
  description?: string;
  username?: string;
}

export interface ITelegramBridge {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isAvailable(): boolean;
  getMode(): "user" | "bot";

  // Identity
  getOwnUserId(): bigint | undefined;
  getUsername(): string | undefined;
  getMe(): Promise<BotInfo | undefined>;

  // Messages
  getMessages(chatId: string, limit: number): Promise<TelegramMessage[]>;
  sendMessage(options: SendMessageOptions): Promise<SentMessage>;
  editMessage(options: EditMessageOptions): Promise<SentMessage>;
  deleteMessage(chatId: string, messageId: number): Promise<boolean>;
  forwardMessage(fromChatId: string, toChatId: string, messageId: number): Promise<SentMessage>;

  // Media
  sendPhoto(
    chatId: string,
    photo: string | Buffer,
    caption?: string,
    replyToId?: number
  ): Promise<SentMessage>;

  // Actions
  setTyping(chatId: string): Promise<void>;
  sendReaction(chatId: string, messageId: number, emoji: string): Promise<void>;
  pinMessage(chatId: string, messageId: number): Promise<boolean>;
  sendDice(chatId: string, emoji?: string): Promise<SentMessage>;

  // Chat info
  getChatInfo(chatId: string): Promise<ChatInfo>;

  // Capabilities
  /** True when the handler must dedup messages via the offset store (user mode redelivers; bot mode dedupes via update_id). */
  requiresOffsetDedup(): boolean;

  /** Stream a response token by token via message drafts. Returns the final sent message. */
  streamResponse?(chatId: string, textStream: AsyncIterable<string>): Promise<SentMessage>;
  /** Push a chunk to a streaming draft. Returns the un-sent remainder. */
  streamDraft?(chatId: string, textStream: AsyncIterable<string>): Promise<string>;
  /** Clear an active streaming draft. */
  clearDraft?(chatId: string): Promise<void>;
  /** Send the final draft as a real message. */
  finalizeDraft?(chatId: string, text: string): Promise<SentMessage>;
  /** Reset draft state for the next iteration. */
  resetDraft?(chatId: string): void;

  // Events
  onNewMessage(
    handler: (msg: TelegramMessage) => void | Promise<void>,
    filters?: { incoming?: boolean; outgoing?: boolean; chats?: string[] }
  ): void;
  fetchReplyContext(rawMsg: unknown): Promise<ReplyContext | null>;
}
