import type Database from "better-sqlite3";
import { serializeEmbedding } from "../embeddings/index.js";
import {
  HYBRID_SEARCH_MIN_SCORE,
  RECENCY_DECAY_FACTOR,
  RECENCY_WEIGHT,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
} from "../../constants/limits.js";
import { createLogger } from "../../utils/logger.js";
import { escapeFts5Query, bm25ToScore } from "./fts-utils.js";

const log = createLogger("Memory");

export interface HybridSearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  createdAt?: number;
  importance?: number;
  lastAccessedAt?: number;
}

/**
 * Parse temporal intent from a search query. Returns a Unix timestamp
 * representing the lower bound (afterTimestamp) if a time reference is found.
 */
const UNIT_SECONDS: Record<string, number> = {
  hour: SECONDS_PER_HOUR,
  day: SECONDS_PER_DAY,
  week: 7 * SECONDS_PER_DAY,
  month: 30 * SECONDS_PER_DAY,
};

export function parseTemporalIntent(query: string): { afterTimestamp?: number } {
  const now = Math.floor(Date.now() / 1000);
  const lower = query.toLowerCase();

  // "N days/hours/weeks ago" or "last N days/hours/weeks"
  const agoMatch = lower.match(/(\d+)\s*(day|hour|week|month)s?\s*ago/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    return { afterTimestamp: now - n * (UNIT_SECONDS[agoMatch[2]] ?? SECONDS_PER_DAY) };
  }

  const lastNMatch = lower.match(/last\s+(\d+)\s*(day|hour|week|month)s?/);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1], 10);
    return { afterTimestamp: now - n * (UNIT_SECONDS[lastNMatch[2]] ?? SECONDS_PER_DAY) };
  }

  if (/\btoday\b/.test(lower)) return { afterTimestamp: now - SECONDS_PER_DAY };
  if (/\byesterday\b/.test(lower)) return { afterTimestamp: now - 2 * SECONDS_PER_DAY };
  if (/\blast\s+week\b/.test(lower)) return { afterTimestamp: now - 7 * SECONDS_PER_DAY };
  if (/\bthis\s+week\b/.test(lower)) return { afterTimestamp: now - 7 * SECONDS_PER_DAY };
  if (/\blast\s+month\b/.test(lower)) return { afterTimestamp: now - 30 * SECONDS_PER_DAY };
  if (/\brecently?\b/.test(lower)) return { afterTimestamp: now - 3 * SECONDS_PER_DAY };

  return {};
}

/**
 * Hybrid search combining vector similarity and BM25 keyword search.
 */
export class HybridSearch {
  constructor(
    private db: Database.Database,
    private vectorEnabled: boolean
  ) {}

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
    const vectorWeight = options.vectorWeight ?? 0.5;
    const keywordWeight = options.keywordWeight ?? 0.5;

    const vectorResults = this.vectorEnabled
      ? this.vectorSearchKnowledge(queryEmbedding, Math.ceil(limit * 3))
      : [];

    const keywordResults = this.keywordSearchKnowledge(query, Math.ceil(limit * 3));

    const results = this.mergeResults(
      vectorResults,
      keywordResults,
      vectorWeight,
      keywordWeight,
      limit
    );

    // Fire-and-forget: track access on returned chunks (deferred to avoid blocking response)
    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      setImmediate(() => {
        try {
          const ph = ids.map(() => "?").join(", ");
          this.db
            .prepare(
              `UPDATE knowledge SET access_count = access_count + 1, last_accessed_at = unixepoch() WHERE id IN (${ph})`
            )
            .run(...ids);
        } catch {
          // Non-blocking — ignore errors
        }
      });
    }

    return results;
  }

  async searchMessages(
    query: string,
    queryEmbedding: number[],
    options: {
      chatId?: string;
      limit?: number;
      vectorWeight?: number;
      keywordWeight?: number;
      afterTimestamp?: number;
    } = {}
  ): Promise<HybridSearchResult[]> {
    const limit = options.limit ?? 10;
    const vectorWeight = options.vectorWeight ?? 0.5;
    const keywordWeight = options.keywordWeight ?? 0.5;

    const vectorResults = this.vectorEnabled
      ? this.vectorSearchMessages(
          queryEmbedding,
          Math.ceil(limit * 3),
          options.chatId,
          options.afterTimestamp
        )
      : [];

    const keywordResults = this.keywordSearchMessages(
      query,
      Math.ceil(limit * 3),
      options.chatId,
      options.afterTimestamp
    );

    return this.mergeResults(vectorResults, keywordResults, vectorWeight, keywordWeight, limit);
  }

  private vectorSearchKnowledge(embedding: number[], limit: number): HybridSearchResult[] {
    if (!this.vectorEnabled || embedding.length === 0) return [];

    try {
      const embeddingBuffer = serializeEmbedding(embedding);

      const rows = this.db
        .prepare(
          `
        SELECT kv.id, k.text, k.source, kv.distance, k.created_at, k.importance, k.last_accessed_at
        FROM (
          SELECT id, distance
          FROM knowledge_vec
          WHERE embedding MATCH ? AND k = ?
        ) kv
        JOIN knowledge k ON k.id = kv.id
        WHERE (k.status = 'active' OR k.status IS NULL)
      `
        )
        .all(embeddingBuffer, limit) as Array<{
        id: string;
        text: string;
        source: string;
        distance: number;
        created_at: number | null;
        importance: number | null;
        last_accessed_at: number | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        source: row.source,
        score: 1 - row.distance,
        vectorScore: 1 - row.distance,
        createdAt: row.created_at ?? undefined,
        importance: row.importance ?? 0.5,
        lastAccessedAt: row.last_accessed_at ?? undefined,
      }));
    } catch (error) {
      log.error({ err: error }, "Vector search error (knowledge)");
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
        SELECT k.id, k.text, k.source, rank as score, k.created_at, k.importance, k.last_accessed_at
        FROM knowledge_fts kf
        JOIN knowledge k ON k.rowid = kf.rowid
        WHERE knowledge_fts MATCH ?
          AND (k.status = 'active' OR k.status IS NULL)
        ORDER BY rank
        LIMIT ?
      `
        )
        .all(safeQuery, limit) as Array<{
        id: string;
        text: string;
        source: string;
        score: number;
        created_at: number | null;
        importance: number | null;
        last_accessed_at: number | null;
      }>;

      return rows.map((row) => ({
        ...row,
        keywordScore: bm25ToScore(row.score),
        createdAt: row.created_at ?? undefined,
        importance: row.importance ?? 0.5,
        lastAccessedAt: row.last_accessed_at ?? undefined,
      }));
    } catch (error) {
      log.error({ err: error }, "FTS5 search error (knowledge)");
      return [];
    }
  }

  private vectorSearchMessages(
    embedding: number[],
    limit: number,
    chatId?: string,
    afterTimestamp?: number
  ): HybridSearchResult[] {
    if (!this.vectorEnabled || embedding.length === 0) return [];

    try {
      const embeddingBuffer = serializeEmbedding(embedding);
      const conditions: string[] = [];
      const params: unknown[] = [embeddingBuffer, limit];

      if (chatId) {
        conditions.push("m.chat_id = ?");
        params.push(chatId);
      }
      if (afterTimestamp) {
        conditions.push("m.timestamp >= ?");
        params.push(afterTimestamp);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const sql = `
        SELECT mv.id, m.text, m.chat_id as source, mv.distance, m.timestamp
        FROM (
          SELECT id, distance
          FROM tg_messages_vec
          WHERE embedding MATCH ? AND k = ?
        ) mv
        JOIN tg_messages m ON (m.chat_id || char(31) || m.id) = mv.id
        ${whereClause}
      `;

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        text: string;
        source: string;
        distance: number;
        timestamp: number | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        text: row.text ?? "",
        source: row.source,
        score: 1 - row.distance,
        vectorScore: 1 - row.distance,
        createdAt: row.timestamp ?? undefined,
      }));
    } catch (error) {
      log.error({ err: error }, "Vector search error (messages)");
      return [];
    }
  }

  private keywordSearchMessages(
    query: string,
    limit: number,
    chatId?: string,
    afterTimestamp?: number
  ): HybridSearchResult[] {
    const safeQuery = escapeFts5Query(query);
    if (!safeQuery) return [];

    try {
      const conditions: string[] = ["tg_messages_fts MATCH ?"];
      const params: unknown[] = [safeQuery];

      if (chatId) {
        conditions.push("m.chat_id = ?");
        params.push(chatId);
      }
      if (afterTimestamp) {
        conditions.push("m.timestamp >= ?");
        params.push(afterTimestamp);
      }
      params.push(limit);

      const sql = `
        SELECT (m.chat_id || char(31) || m.id) AS id,
               m.text, m.chat_id as source, rank as score, m.timestamp
        FROM tg_messages_fts mf
        JOIN tg_messages m ON m.rowid = mf.rowid
        WHERE ${conditions.join(" AND ")}
        ORDER BY rank
        LIMIT ?
      `;

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        text: string;
        source: string;
        score: number;
        timestamp: number | null;
      }>;

      return rows.map((row) => ({
        ...row,
        text: row.text ?? "",
        keywordScore: bm25ToScore(row.score),
        createdAt: row.timestamp ?? undefined,
      }));
    } catch (error) {
      log.error({ err: error }, "FTS5 search error (messages)");
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

    const now = Math.floor(Date.now() / 1000);
    const results = Array.from(byId.values());
    for (const r of results) {
      if (r.source !== "message" && r.importance !== undefined) {
        // Composite scoring for knowledge: 0.4 × relevance + 0.3 × importance + 0.3 × recency
        const refTime = r.lastAccessedAt ?? r.createdAt ?? now;
        const hoursSince = Math.max(0, (now - refTime) / SECONDS_PER_HOUR);
        const recency = Math.pow(0.995, hoursSince);
        r.score = 0.4 * r.score + 0.3 * r.importance + 0.3 * recency;
      } else if (r.createdAt) {
        // Legacy recency boost for messages
        const ageDays = Math.max(0, (now - r.createdAt) / SECONDS_PER_DAY);
        const boost = 1 / (1 + ageDays * RECENCY_DECAY_FACTOR);
        r.score *= 1 - RECENCY_WEIGHT + RECENCY_WEIGHT * boost;
      }
    }

    return results
      .filter((r) => r.score >= HYBRID_SEARCH_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
