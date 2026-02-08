import type Database from "better-sqlite3";

export interface HybridSearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

/**
 * Escape special characters for FTS5 query
 * FTS5 special chars: " * - + ( ) : ^ ~ . @ # $ % & ! ? [ ] { } | \ / < > = , ; '
 */
function escapeFts5Query(query: string): string {
  // Remove all FTS5 special characters and punctuation that can cause syntax errors
  return query
    .replace(/["\*\-\+\(\)\:\^\~\?\.\@\#\$\%\&\!\[\]\{\}\|\\\/<>=,;'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hybrid search combining vector similarity and BM25 keyword search
 */
export class HybridSearch {
  constructor(
    private db: Database.Database,
    private vectorEnabled: boolean
  ) {}

  /**
   * Search in knowledge base
   */
  async searchKnowledge(
    query: string,
    queryEmbedding: number[],
    options: {
      limit?: number;
      vectorWeight?: number;
      keywordWeight?: number;
    } = {}
  ): Promise<HybridSearchResult[]> {
    const limit = options.limit ?? 10;
    const vectorWeight = options.vectorWeight ?? 0.7;
    const keywordWeight = options.keywordWeight ?? 0.3;

    // Vector search
    const vectorResults = this.vectorEnabled
      ? this.vectorSearchKnowledge(queryEmbedding, limit * 2)
      : [];

    // Keyword search (BM25)
    const keywordResults = this.keywordSearchKnowledge(query, limit * 2);

    // Merge results
    return this.mergeResults(vectorResults, keywordResults, vectorWeight, keywordWeight, limit);
  }

  /**
   * Search in Telegram messages
   */
  async searchMessages(
    query: string,
    queryEmbedding: number[],
    options: {
      chatId?: string;
      limit?: number;
      vectorWeight?: number;
      keywordWeight?: number;
    } = {}
  ): Promise<HybridSearchResult[]> {
    const limit = options.limit ?? 10;
    const vectorWeight = options.vectorWeight ?? 0.7;
    const keywordWeight = options.keywordWeight ?? 0.3;

    // Vector search
    const vectorResults = this.vectorEnabled
      ? this.vectorSearchMessages(queryEmbedding, limit * 2, options.chatId)
      : [];

    // Keyword search
    const keywordResults = this.keywordSearchMessages(query, limit * 2, options.chatId);

    // Merge results
    return this.mergeResults(vectorResults, keywordResults, vectorWeight, keywordWeight, limit);
  }

  private vectorSearchKnowledge(embedding: number[], limit: number): HybridSearchResult[] {
    if (!this.vectorEnabled || embedding.length === 0) return [];

    try {
      // Serialize embedding to Buffer
      const embeddingBuffer = this.serializeEmbedding(embedding);

      const rows = this.db
        .prepare(
          `
        SELECT kv.id, k.text, k.source, kv.distance
        FROM knowledge_vec kv
        JOIN knowledge k ON k.id = kv.id
        WHERE kv.embedding MATCH ?
        ORDER BY kv.distance
        LIMIT ?
      `
        )
        .all(embeddingBuffer, limit) as Array<{
        id: string;
        text: string;
        source: string;
        distance: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.source,
        score: 1 - row.distance, // Convert distance to similarity
        vectorScore: 1 - row.distance,
      }));
    } catch (error) {
      console.error("Vector search error (knowledge):", error);
      return [];
    }
  }

  private keywordSearchKnowledge(query: string, limit: number): HybridSearchResult[] {
    const safeQuery = escapeFts5Query(query);
    if (!safeQuery) return [];

    try {
      const rows = this.db
        .prepare(
          `
        SELECT k.id, k.text, k.source, rank as score
        FROM knowledge_fts kf
        JOIN knowledge k ON k.rowid = kf.rowid
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
        )
        .all(safeQuery, limit) as Array<{
        id: string;
        text: string;
        source: string;
        score: number;
      }>;

      return rows.map((row) => ({
        ...row,
        keywordScore: this.bm25ToScore(row.score),
      }));
    } catch (error) {
      console.error("FTS5 search error (knowledge):", error);
      return [];
    }
  }

  private vectorSearchMessages(
    embedding: number[],
    limit: number,
    chatId?: string
  ): HybridSearchResult[] {
    if (!this.vectorEnabled || embedding.length === 0) return [];

    try {
      // Serialize embedding to Buffer
      const embeddingBuffer = this.serializeEmbedding(embedding);

      const sql = chatId
        ? `
        SELECT mv.id, m.text, m.chat_id as source, mv.distance
        FROM tg_messages_vec mv
        JOIN tg_messages m ON m.id = mv.id
        WHERE mv.embedding MATCH ? AND m.chat_id = ?
        ORDER BY mv.distance
        LIMIT ?
      `
        : `
        SELECT mv.id, m.text, m.chat_id as source, mv.distance
        FROM tg_messages_vec mv
        JOIN tg_messages m ON m.id = mv.id
        WHERE mv.embedding MATCH ?
        ORDER BY mv.distance
        LIMIT ?
      `;

      const rows = chatId
        ? (this.db.prepare(sql).all(embeddingBuffer, chatId, limit) as Array<{
            id: string;
            text: string;
            source: string;
            distance: number;
          }>)
        : (this.db.prepare(sql).all(embeddingBuffer, limit) as Array<{
            id: string;
            text: string;
            source: string;
            distance: number;
          }>);

      return rows.map((row) => ({
        id: row.id,
        text: row.text ?? "",
        source: row.source,
        score: 1 - row.distance,
        vectorScore: 1 - row.distance,
      }));
    } catch (error) {
      console.error("Vector search error (messages):", error);
      return [];
    }
  }

  private keywordSearchMessages(
    query: string,
    limit: number,
    chatId?: string
  ): HybridSearchResult[] {
    const safeQuery = escapeFts5Query(query);
    if (!safeQuery) return [];

    try {
      const sql = chatId
        ? `
        SELECT m.id, m.text, m.chat_id as source, rank as score
        FROM tg_messages_fts mf
        JOIN tg_messages m ON m.rowid = mf.rowid
        WHERE tg_messages_fts MATCH ? AND m.chat_id = ?
        ORDER BY rank
        LIMIT ?
      `
        : `
        SELECT m.id, m.text, m.chat_id as source, rank as score
        FROM tg_messages_fts mf
        JOIN tg_messages m ON m.rowid = mf.rowid
        WHERE tg_messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      const rows = chatId
        ? (this.db.prepare(sql).all(safeQuery, chatId, limit) as Array<{
            id: string;
            text: string;
            source: string;
            score: number;
          }>)
        : (this.db.prepare(sql).all(safeQuery, limit) as Array<{
            id: string;
            text: string;
            source: string;
            score: number;
          }>);

      return rows.map((row) => ({
        ...row,
        text: row.text ?? "",
        keywordScore: this.bm25ToScore(row.score),
      }));
    } catch (error) {
      console.error("FTS5 search error (messages):", error);
      return [];
    }
  }

  private mergeResults(
    vectorResults: HybridSearchResult[],
    keywordResults: HybridSearchResult[],
    vectorWeight: number,
    keywordWeight: number,
    limit: number
  ): HybridSearchResult[] {
    const byId = new Map<string, HybridSearchResult>();

    for (const r of vectorResults) {
      byId.set(r.id, { ...r, vectorScore: r.score });
    }

    for (const r of keywordResults) {
      const existing = byId.get(r.id);
      if (existing) {
        existing.keywordScore = r.keywordScore;
        existing.score =
          vectorWeight * (existing.vectorScore ?? 0) + keywordWeight * (r.keywordScore ?? 0);
      } else {
        byId.set(r.id, { ...r, score: keywordWeight * (r.keywordScore ?? 0) });
      }
    }

    return Array.from(byId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private bm25ToScore(rank: number): number {
    // Convert BM25 rank to 0-1 score
    return 1 / (1 + Math.abs(rank));
  }

  /**
   * Serialize embedding (number[]) to Buffer for sqlite-vec
   */
  private serializeEmbedding(embedding: number[]): Buffer {
    const float32 = new Float32Array(embedding);
    return Buffer.from(float32.buffer);
  }
}
