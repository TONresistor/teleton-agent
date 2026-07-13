import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { serializeEmbedding } from "../embeddings/index.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Memory");

const MESSAGE_KEY_SEPARATOR = "\u001f";

export function telegramMessageKey(chatId: string, messageId: string): string {
  return `${chatId}${MESSAGE_KEY_SEPARATOR}${messageId}`;
}

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

export function pruneOldMessages(db: Database.Database, maxAgeDays = 90): number {
  const cutoffSec = Math.floor(Date.now() / 1000) - maxAgeDays * 86_400;
  const result = db.prepare("DELETE FROM tg_messages WHERE timestamp < ?").run(cutoffSec);
  return result.changes;
}

export class MessageStore {
  constructor(
    private db: Database.Database,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean
  ) {}

  private ensureChat(chatId: string, isGroup: boolean = false): void {
    const existing = this.db.prepare(`SELECT id FROM tg_chats WHERE id = ?`).get(chatId);
    if (!existing) {
      this.db
        .prepare(`INSERT INTO tg_chats (id, type, is_monitored) VALUES (?, ?, 1)`)
        .run(chatId, isGroup ? "group" : "dm");
    }
  }

  private ensureUser(userId: string): void {
    if (!userId) return;
    const existing = this.db.prepare(`SELECT id FROM tg_users WHERE id = ?`).get(userId);
    if (!existing) {
      this.db.prepare(`INSERT INTO tg_users (id) VALUES (?)`).run(userId);
    }
  }

  async storeMessage(message: TelegramMessage): Promise<void> {
    this.ensureChat(message.chatId);
    if (message.senderId) {
      this.ensureUser(message.senderId);
    }

    this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO tg_messages (
          id, chat_id, sender_id, text, embedding, embedding_status, reply_to_id,
          is_from_agent, has_media, media_type, timestamp
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, id) DO UPDATE SET
          sender_id = excluded.sender_id,
          text = excluded.text,
          embedding = NULL,
          embedding_status = excluded.embedding_status,
          reply_to_id = excluded.reply_to_id,
          is_from_agent = excluded.is_from_agent,
          has_media = excluded.has_media,
          media_type = excluded.media_type,
          timestamp = excluded.timestamp,
          indexed_at = unixepoch()
      `
        )
        .run(
          message.id,
          message.chatId,
          message.senderId,
          message.text,
          this.vectorEnabled && message.text ? "pending" : "disabled",
          message.replyToId,
          message.isFromAgent ? 1 : 0,
          message.hasMedia ? 1 : 0,
          message.mediaType,
          message.timestamp
        );

      this.db
        .prepare(`UPDATE tg_chats SET last_message_at = ?, last_message_id = ? WHERE id = ?`)
        .run(message.timestamp, message.id, message.chatId);
    })();

    if (!this.vectorEnabled) return;

    try {
      // The canonical message row is committed before touching the optional
      // vector table. A vec extension/table failure must never lose history.
      this.db
        .prepare("DELETE FROM tg_messages_vec WHERE id = ?")
        .run(telegramMessageKey(message.chatId, message.id));
      if (!message.text) return;
      await this.persistEmbedding(message.chatId, message.id, message.text);
    } catch (error) {
      if (message.text) this.markEmbeddingFailed(message.chatId, message.id);
      log.warn(
        { err: error, chatId: message.chatId, messageId: message.id },
        "Message persisted but vector indexing failed"
      );
    }
  }

  async backfillPendingEmbeddings(limit = 100): Promise<{ indexed: number; failed: number }> {
    if (!this.vectorEnabled) return { indexed: 0, failed: 0 };
    const rows = this.db
      .prepare(
        `SELECT chat_id, id, text FROM tg_messages
         WHERE text IS NOT NULL AND embedding_status IN ('pending', 'failed')
         ORDER BY indexed_at ASC LIMIT ?`
      )
      .all(limit) as Array<{ chat_id: string; id: string; text: string }>;

    let indexed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.persistEmbedding(row.chat_id, row.id, row.text);
        indexed++;
      } catch (error) {
        failed++;
        this.markEmbeddingFailed(row.chat_id, row.id);
        log.warn(
          { err: error, chatId: row.chat_id, messageId: row.id },
          "Message embedding backfill failed"
        );
      }
    }
    return { indexed, failed };
  }

  private async persistEmbedding(chatId: string, messageId: string, text: string): Promise<void> {
    const embedding = await this.embedder.embedQuery(text);
    if (embedding.length === 0) {
      throw new Error("Embedding provider returned an empty vector");
    }
    const embeddingBuffer = serializeEmbedding(embedding);
    const storageKey = telegramMessageKey(chatId, messageId);

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE tg_messages
           SET embedding = ?, embedding_status = 'ready', indexed_at = unixepoch()
           WHERE chat_id = ? AND id = ?`
        )
        .run(embeddingBuffer, chatId, messageId);

      this.db.prepare("DELETE FROM tg_messages_vec WHERE id = ?").run(storageKey);
      this.db
        .prepare("INSERT INTO tg_messages_vec (id, embedding) VALUES (?, ?)")
        .run(storageKey, embeddingBuffer);
    })();
  }

  private markEmbeddingFailed(chatId: string, messageId: string): void {
    this.db
      .prepare(
        `UPDATE tg_messages SET embedding_status = 'failed', indexed_at = unixepoch()
         WHERE chat_id = ? AND id = ?`
      )
      .run(chatId, messageId);
  }

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
