import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { assertValidEmbedding, serializeEmbedding } from "../embeddings/index.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Memory");

const MESSAGE_KEY_SEPARATOR = "\u001f";
const BACKFILL_BATCH_SIZE = 16;
const BACKFILL_DELAY_MS = 250;
const BACKFILL_START_DELAY_MS = 100;

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
  private pendingBackfill: Promise<void> | null = null;
  private pendingBackfillAbort: AbortController | null = null;
  private pendingBackfillStart: ReturnType<typeof setTimeout> | null = null;

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
    const textToEmbed = message.text?.trim() ? message.text : null;
    const shouldHaveEmbedding = this.embedder.id !== "noop" && textToEmbed !== null;

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
          shouldHaveEmbedding ? "pending" : "disabled",
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

    if (!this.vectorEnabled) {
      this.db
        .prepare(
          `INSERT INTO meta (key, value, updated_at)
           VALUES ('tg_messages_vector_rebuild_required', '1', unixepoch())
           ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = unixepoch()`
        )
        .run();
      return;
    }

    // The canonical row is already durable. Vector cleanup and indexing are
    // deliberately asynchronous so Telegram handling never waits for ONNX or
    // remote embedding work.
    try {
      this.db
        .prepare("DELETE FROM tg_messages_vec WHERE id = ?")
        .run(telegramMessageKey(message.chatId, message.id));
    } catch (error) {
      log.warn(
        { err: error, chatId: message.chatId, messageId: message.id },
        "Message persisted but stale vector cleanup failed"
      );
    }

    if (shouldHaveEmbedding && textToEmbed !== null) {
      this.schedulePendingEmbeddingBackfill();
    }
  }

  async backfillPendingEmbeddings(
    limit = 100,
    includeFailed = true
  ): Promise<{ indexed: number; failed: number; skipped: number }> {
    if (!this.vectorEnabled) return { indexed: 0, failed: 0, skipped: 0 };
    const statusFilter = includeFailed
      ? "embedding_status IN ('pending', 'failed')"
      : "embedding_status = 'pending'";
    const rows = this.db
      .prepare(
        `SELECT chat_id, id, text FROM tg_messages
         WHERE text IS NOT NULL AND length(trim(text)) > 0
           AND ${statusFilter}
         ORDER BY indexed_at ASC LIMIT ?`
      )
      .all(limit) as Array<{ chat_id: string; id: string; text: string }>;

    if (rows.length === 0) return { indexed: 0, failed: 0, skipped: 0 };

    let indexed = 0;
    let failed = 0;
    let skipped = 0;
    for (let offset = 0; offset < rows.length; offset += BACKFILL_BATCH_SIZE) {
      const batchRows = rows.slice(offset, offset + BACKFILL_BATCH_SIZE);
      let embeddings: number[][];
      try {
        embeddings = await this.embedder.embedBatch(batchRows.map((row) => row.text));
        if (embeddings.length !== batchRows.length) {
          throw new Error(
            `Embedding batch size mismatch: expected ${batchRows.length}, received ${embeddings.length}`
          );
        }
      } catch (error) {
        let batchFailed = 0;
        for (const row of batchRows) {
          if (this.markEmbeddingFailed(row.chat_id, row.id, row.text)) batchFailed++;
        }
        failed += batchFailed;
        skipped += batchRows.length - batchFailed;
        log.warn({ err: error, messages: batchRows.length }, "Message embedding batch failed");
        continue;
      }

      for (const [index, row] of batchRows.entries()) {
        try {
          const embedding = embeddings[index];
          assertValidEmbedding(embedding, this.embedder.dimensions);
          if (this.persistPreparedEmbedding(row, embedding)) indexed++;
          else skipped++;
        } catch (error) {
          if (this.markEmbeddingFailed(row.chat_id, row.id, row.text)) failed++;
          else skipped++;
          log.warn(
            { err: error, chatId: row.chat_id, messageId: row.id },
            "Message embedding backfill failed"
          );
        }
      }
    }
    return { indexed, failed, skipped };
  }

  startPendingEmbeddingBackfill(
    batchSize = BACKFILL_BATCH_SIZE,
    delayMs = BACKFILL_DELAY_MS
  ): Promise<void> {
    if (this.pendingBackfillStart) {
      clearTimeout(this.pendingBackfillStart);
      this.pendingBackfillStart = null;
    }
    if (this.pendingBackfill) return this.pendingBackfill;

    const controller = new AbortController();
    this.pendingBackfillAbort = controller;
    const promise = this.runPendingEmbeddingBackfill(batchSize, delayMs, controller.signal);
    this.pendingBackfill = promise;
    void promise
      .then(() => {
        if (this.pendingBackfill === promise) {
          this.pendingBackfill = null;
          this.pendingBackfillAbort = null;
          if (!controller.signal.aborted && this.hasPendingEmbeddings()) {
            void this.startPendingEmbeddingBackfill(batchSize, delayMs);
          }
        }
      })
      .catch((error) => log.warn({ err: error }, "Message embedding queue cleanup failed"));
    return promise;
  }

  async stopAndDrainPendingEmbeddingBackfill(): Promise<void> {
    if (this.pendingBackfillStart) {
      clearTimeout(this.pendingBackfillStart);
      this.pendingBackfillStart = null;
    }
    const promise = this.pendingBackfill;
    this.pendingBackfillAbort?.abort();
    if (promise) await promise;
  }

  private schedulePendingEmbeddingBackfill(): void {
    if (this.pendingBackfill || this.pendingBackfillStart) return;
    this.pendingBackfillStart = setTimeout(() => {
      this.pendingBackfillStart = null;
      void this.startPendingEmbeddingBackfill();
    }, BACKFILL_START_DELAY_MS);
    this.pendingBackfillStart.unref();
  }

  private async runPendingEmbeddingBackfill(
    batchSize: number,
    delayMs: number,
    signal: AbortSignal
  ): Promise<void> {
    let indexed = 0;
    let failed = 0;

    try {
      while (!signal.aborted) {
        const batch = await this.backfillPendingEmbeddings(batchSize, false);
        indexed += batch.indexed;
        failed += batch.failed;
        if (batch.indexed + batch.failed + batch.skipped === 0) break;
        if (batch.indexed < batchSize) break;
        await this.waitForBackfillDelay(delayMs, signal);
      }
    } catch (error) {
      log.warn({ err: error }, "Message embedding background backfill stopped");
    }

    if (indexed > 0 || failed > 0) {
      log.info(`Message embedding background backfill: ${indexed} indexed, ${failed} failed`);
    }
  }

  private async waitForBackfillDelay(delayMs: number, signal: AbortSignal): Promise<void> {
    if (delayMs <= 0 || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      timer.unref();
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private hasPendingEmbeddings(): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM tg_messages
           WHERE embedding_status = 'pending'
             AND text IS NOT NULL AND length(trim(text)) > 0
           LIMIT 1`
        )
        .get()
    );
  }

  private persistPreparedEmbedding(
    row: { chat_id: string; id: string; text: string },
    embedding: number[]
  ): boolean {
    const embeddingBuffer = serializeEmbedding(embedding);
    const storageKey = telegramMessageKey(row.chat_id, row.id);

    return this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE tg_messages
           SET embedding = ?, embedding_status = 'ready', indexed_at = unixepoch()
           WHERE chat_id = ? AND id = ? AND text = ?
             AND embedding_status IN ('pending', 'failed')`
        )
        .run(embeddingBuffer, row.chat_id, row.id, row.text).changes;

      if (updated === 0) return false;

      this.db.prepare("DELETE FROM tg_messages_vec WHERE id = ?").run(storageKey);
      this.db
        .prepare(
          `INSERT INTO tg_messages_vec (id, chat_id, message_id, timestamp, embedding)
           SELECT ?, chat_id, id, timestamp, ? FROM tg_messages
           WHERE chat_id = ? AND id = ?`
        )
        .run(storageKey, embeddingBuffer, row.chat_id, row.id);
      return true;
    })();
  }

  private markEmbeddingFailed(chatId: string, messageId: string, text: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE tg_messages SET embedding_status = 'failed', indexed_at = unixepoch()
         WHERE chat_id = ? AND id = ? AND text = ?
           AND embedding_status IN ('pending', 'failed')`
        )
        .run(chatId, messageId, text).changes > 0
    );
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
