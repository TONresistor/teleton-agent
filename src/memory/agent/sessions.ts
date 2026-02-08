import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { randomUUID } from "crypto";

export interface Session {
  id: string;
  chatId?: string;
  startedAt: Date;
  endedAt?: Date;
  summary?: string;
  messageCount: number;
  tokensUsed: number;
}

export interface SessionEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/**
 * Manage agent sessions (conversation transcripts)
 */
export class SessionStore {
  constructor(
    private db: Database.Database,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean
  ) {}

  /**
   * Create a new session
   */
  createSession(chatId?: string): Session {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      INSERT INTO sessions (id, chat_id, started_at, message_count, tokens_used)
      VALUES (?, ?, ?, 0, 0)
    `
      )
      .run(id, chatId ?? null, now);

    return {
      id,
      chatId,
      startedAt: new Date(now * 1000),
      messageCount: 0,
      tokensUsed: 0,
    };
  }

  /**
   * End a session with summary
   */
  endSession(sessionId: string, summary: string, tokensUsed: number = 0): void {
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      UPDATE sessions
      SET ended_at = ?, summary = ?, tokens_used = ?
      WHERE id = ?
    `
      )
      .run(now, summary, tokensUsed, sessionId);
  }

  /**
   * Update message count for a session
   */
  incrementMessageCount(sessionId: string, count: number = 1): void {
    this.db
      .prepare(
        `
      UPDATE sessions
      SET message_count = message_count + ?
      WHERE id = ?
    `
      )
      .run(count, sessionId);
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): Session | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      chatId: row.chat_id,
      startedAt: new Date(row.started_at * 1000),
      endedAt: row.ended_at ? new Date(row.ended_at * 1000) : undefined,
      summary: row.summary,
      messageCount: row.message_count,
      tokensUsed: row.tokens_used,
    };
  }

  /**
   * Get active (not ended) sessions
   */
  getActiveSessions(): Session[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE ended_at IS NULL
      ORDER BY started_at DESC
    `
      )
      .all() as any[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      startedAt: new Date(row.started_at * 1000),
      endedAt: undefined,
      summary: row.summary,
      messageCount: row.message_count,
      tokensUsed: row.tokens_used,
    }));
  }

  /**
   * Get sessions for a specific chat
   */
  getSessionsByChat(chatId: string, limit: number = 50): Session[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE chat_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `
      )
      .all(chatId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      startedAt: new Date(row.started_at * 1000),
      endedAt: row.ended_at ? new Date(row.ended_at * 1000) : undefined,
      summary: row.summary,
      messageCount: row.message_count,
      tokensUsed: row.tokens_used,
    }));
  }

  /**
   * Index a session for search (after ending)
   * This creates a knowledge entry from the session summary
   */
  async indexSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session || !session.summary) return;

    try {
      // Create knowledge entry
      const knowledgeId = `session:${sessionId}`;
      const text = `Session from ${session.startedAt.toISOString()}:\n${session.summary}`;

      // Compute hash
      const hash = this.hashText(text);

      // Compute embedding if vector search enabled
      let embedding: number[] | null = null;
      if (this.vectorEnabled) {
        embedding = await this.embedder.embedQuery(text);
      }

      // Store in knowledge table
      this.db
        .prepare(
          `
        INSERT INTO knowledge (id, source, path, text, hash, created_at, updated_at)
        VALUES (?, 'session', ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          text = excluded.text,
          hash = excluded.hash,
          updated_at = excluded.updated_at
      `
        )
        .run(knowledgeId, sessionId, text, hash);

      // Store embedding if available
      if (embedding && this.vectorEnabled) {
        const embeddingBuffer = this.serializeEmbedding(embedding);
        const rowid = this.db
          .prepare(`SELECT rowid FROM knowledge WHERE id = ?`)
          .get(knowledgeId) as { rowid: number };

        this.db
          .prepare(
            `
          INSERT INTO knowledge_vec (rowid, embedding)
          VALUES (?, ?)
          ON CONFLICT(rowid) DO UPDATE SET embedding = excluded.embedding
        `
          )
          .run(rowid.rowid, embeddingBuffer);
      }

      console.log(`Indexed session ${sessionId} to knowledge base`);
    } catch (error) {
      console.error("Error indexing session:", error);
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(`session:${sessionId}`);
  }

  private hashText(text: string): string {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private serializeEmbedding(embedding: number[]): Buffer {
    const float32 = new Float32Array(embedding);
    return Buffer.from(float32.buffer);
  }
}
