import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { hashText, serializeEmbedding, embeddingToBlob } from "../embeddings/index.js";

export interface TelegramMessage {
  id: string;
  chatId: string;
  senderId: string | null;
  text: string | null;
  replyToId?: string;
  isFromAgent: boolean;
  hasMedia: boolean;
  mediaType?: string;
  timestamp: number;
}

/**
 * Store and retrieve Telegram messages
 */
export class MessageStore {
  constructor(
    private db: Database.Database,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean
  ) {}

  /**
   * Ensure chat exists in database
   */
  private ensureChat(chatId: string, isGroup: boolean = false): void {
    const existing = this.db.prepare(`SELECT id FROM tg_chats WHERE id = ?`).get(chatId);
    if (!existing) {
      this.db
        .prepare(`INSERT INTO tg_chats (id, type, is_monitored) VALUES (?, ?, 1)`)
        .run(chatId, isGroup ? "group" : "dm");
    }
  }

  /**
   * Ensure user exists in database
   */
  private ensureUser(userId: string): void {
    if (!userId) return;
    const existing = this.db.prepare(`SELECT id FROM tg_users WHERE id = ?`).get(userId);
    if (!existing) {
      this.db.prepare(`INSERT INTO tg_users (id) VALUES (?)`).run(userId);
    }
  }

  /**
   * Store a message
   */
  async storeMessage(message: TelegramMessage): Promise<void> {
    // Ensure chat and user exist before inserting message (for foreign keys)
    this.ensureChat(message.chatId);
    if (message.senderId) {
      this.ensureUser(message.senderId);
    }

    const embedding = message.text ? await this.embedder.embedQuery(message.text) : [];

    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO tg_messages (
        id, chat_id, sender_id, text, embedding, reply_to_id,
        is_from_agent, has_media, media_type, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        message.id,
        message.chatId,
        message.senderId,
        message.text,
        serializeEmbedding(embedding),
        message.replyToId,
        message.isFromAgent ? 1 : 0,
        message.hasMedia ? 1 : 0,
        message.mediaType,
        message.timestamp
      );

    if (this.vectorEnabled && embedding.length > 0 && message.text) {
      this.db
        .prepare(`INSERT OR REPLACE INTO tg_messages_vec (id, embedding) VALUES (?, ?)`)
        .run(message.id, embeddingToBlob(embedding));
    }

    // Update chat last_message_at
    this.db
      .prepare(`UPDATE tg_chats SET last_message_at = ?, last_message_id = ? WHERE id = ?`)
      .run(message.timestamp, message.id, message.chatId);
  }

  /**
   * Get recent messages from a chat
   */
  getRecentMessages(chatId: string, limit: number = 20): TelegramMessage[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, chat_id, sender_id, text, reply_to_id, is_from_agent, has_media, media_type, timestamp
      FROM tg_messages
      WHERE chat_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `
      )
      .all(chatId, limit) as Array<{
      id: string;
      chat_id: string;
      sender_id: string | null;
      text: string | null;
      reply_to_id: string | null;
      is_from_agent: number;
      has_media: number;
      media_type: string | null;
      timestamp: number;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      text: row.text,
      replyToId: row.reply_to_id ?? undefined,
      isFromAgent: Boolean(row.is_from_agent),
      hasMedia: Boolean(row.has_media),
      mediaType: row.media_type ?? undefined,
      timestamp: row.timestamp,
    }));
  }
}
