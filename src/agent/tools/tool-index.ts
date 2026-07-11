import type Database from "better-sqlite3";
import type { Tool as PiAiTool } from "@earendil-works/pi-ai";
import type { EmbeddingProvider } from "../../memory/embeddings/provider.js";
import { serializeEmbedding } from "../../memory/embeddings/index.js";
import {
  TOOL_RAG_MIN_SCORE,
  TOOL_RAG_VECTOR_WEIGHT,
  TOOL_RAG_KEYWORD_WEIGHT,
} from "../../constants/limits.js";
import { createLogger } from "../../utils/logger.js";
import { escapeFts5Query, bm25ToScore } from "../../memory/search/fts-utils.js";

const log = createLogger("ToolRAG");

export interface ToolIndexConfig {
  topK: number;
  alwaysInclude: string[];
  skipUnlimitedProviders: boolean;
}

export interface ToolSearchResult {
  name: string;
  description: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

/**
 * Semantic index for tool definitions.
 * Uses the same hybrid search pattern (vector + FTS5) as the knowledge RAG.
 */
export class ToolIndex {
  private _isIndexed = false;

  constructor(
    private db: Database.Database,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean,
    private config: ToolIndexConfig
  ) {}

  get isIndexed(): boolean {
    return this._isIndexed;
  }

  /**
   * Create the vector table (dimensions are dynamic, so can't be in schema migration).
   */
  ensureSchema(): void {
    if (!this.vectorEnabled || this.embedder.dimensions === 0) return;

    try {
      // Check if existing table has correct dimensions
      const existing = this.db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tool_index_vec'`)
        .get() as { sql?: string } | undefined;

      if (existing?.sql && !existing.sql.includes(`[${this.embedder.dimensions}]`)) {
        this.db.exec(`DROP TABLE IF EXISTS tool_index_vec`);
      }

      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS tool_index_vec USING vec0(
          name TEXT PRIMARY KEY,
          embedding FLOAT[${this.embedder.dimensions}] distance_metric=cosine
        );
      `);
    } catch (error) {
      log.error({ err: error }, "Failed to create vector table");
      this.vectorEnabled = false;
    }
  }

  /**
   * Index all registered tools. Replaces any previous index.
   */
  async indexAll(tools: PiAiTool[]): Promise<number> {
    try {
      // Clear existing data
      this.db.exec(`DELETE FROM tool_index`);
      if (this.vectorEnabled) {
        try {
          this.db.exec(`DELETE FROM tool_index_vec`);
        } catch {
          // table may not exist
        }
      }

      // Build search texts
      const entries = tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        searchText: `${t.name} — ${t.description ?? ""}`,
      }));

      // Embed in batches
      const embeddings: number[][] = [];
      if (this.vectorEnabled && this.embedder.dimensions > 0) {
        const texts = entries.map((e) => e.searchText);
        const batchSize = 128;
        for (let i = 0; i < texts.length; i += batchSize) {
          const batch = texts.slice(i, i + batchSize);
          const batchEmbeddings = await this.embedder.embedBatch(batch);
          embeddings.push(...batchEmbeddings);
        }
      }

      // Insert in transaction
      const insertTool = this.db.prepare(`
        INSERT INTO tool_index (name, description, search_text, updated_at)
        VALUES (?, ?, ?, unixepoch())
      `);

      const insertVec = this.vectorEnabled
        ? this.db.prepare(`INSERT INTO tool_index_vec (name, embedding) VALUES (?, ?)`)
        : null;

      const txn = this.db.transaction(() => {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          insertTool.run(e.name, e.description, e.searchText);

          if (insertVec && embeddings[i]?.length > 0) {
            insertVec.run(e.name, serializeEmbedding(embeddings[i]));
          }
        }
      });
      txn();

      this._isIndexed = true;
      return entries.length;
    } catch (error) {
      log.error({ err: error }, "Indexing failed");
      this._isIndexed = false;
      return 0;
    }
  }

  /**
   * Delta update for hot-reload plugins.
   */
  async reindexTools(removed: string[], added: PiAiTool[]): Promise<void> {
    try {
      // Remove old tools
      if (removed.length > 0) {
        const deleteTool = this.db.prepare(`DELETE FROM tool_index WHERE name = ?`);
        const deleteVec = this.vectorEnabled
          ? this.db.prepare(`DELETE FROM tool_index_vec WHERE name = ?`)
          : null;

        for (const name of removed) {
          deleteTool.run(name);
          deleteVec?.run(name);
        }
      }

      // Add new tools
      if (added.length > 0) {
        const entries = added.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          searchText: `${t.name} — ${t.description ?? ""}`,
        }));

        let embeddings: number[][] = [];
        if (this.vectorEnabled && this.embedder.dimensions > 0) {
          embeddings = await this.embedder.embedBatch(entries.map((e) => e.searchText));
        }

        const insertTool = this.db.prepare(`
          INSERT OR REPLACE INTO tool_index (name, description, search_text, updated_at)
          VALUES (?, ?, ?, unixepoch())
        `);
        // vec0 virtual tables don't support OR REPLACE — delete first, then insert
        const deleteVec = this.vectorEnabled
          ? this.db.prepare(`DELETE FROM tool_index_vec WHERE name = ?`)
          : null;
        const insertVec = this.vectorEnabled
          ? this.db.prepare(`INSERT INTO tool_index_vec (name, embedding) VALUES (?, ?)`)
          : null;

        const txn = this.db.transaction(() => {
          for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            insertTool.run(e.name, e.description, e.searchText);
            if (insertVec && embeddings[i]?.length > 0) {
              deleteVec?.run(e.name);
              insertVec.run(e.name, serializeEmbedding(embeddings[i]));
            }
          }
        });
        txn();
      }

      log.info(`Delta reindex: -${removed.length} +${added.length} tools`);
    } catch (error) {
      log.error({ err: error }, "Delta reindex failed");
    }
  }

  /**
   * Hybrid search: vector + FTS5, same pattern as HybridSearch.
   */
  async search(
    query: string,
    queryEmbedding: number[],
    limit?: number
  ): Promise<ToolSearchResult[]> {
    const topK = limit ?? this.config.topK;

    const vectorResults = this.vectorEnabled ? this.vectorSearch(queryEmbedding, topK * 3) : [];

    const keywordResults = this.keywordSearch(query, topK * 3);

    return this.mergeResults(vectorResults, keywordResults, topK);
  }

  /**
   * Check if a tool name matches any always-include pattern.
   */
  isAlwaysIncluded(toolName: string): boolean {
    for (const pattern of this.config.alwaysInclude) {
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        if (toolName.startsWith(prefix)) return true;
      } else if (toolName === pattern) {
        return true;
      }
    }
    return false;
  }

  private vectorSearch(embedding: number[], limit: number): ToolSearchResult[] {
    if (!this.vectorEnabled || embedding.length === 0) return [];

    try {
      const embeddingBuffer = serializeEmbedding(embedding);

      const rows = this.db
        .prepare(
          `
          SELECT tv.name, ti.description, tv.distance
          FROM (
            SELECT name, distance
            FROM tool_index_vec
            WHERE embedding MATCH ? AND k = ?
          ) tv
          JOIN tool_index ti ON ti.name = tv.name
        `
        )
        .all(embeddingBuffer, limit) as Array<{
        name: string;
        description: string;
        distance: number;
      }>;

      return rows.map((row) => ({
        name: row.name,
        description: row.description,
        score: 1 - row.distance,
        vectorScore: 1 - row.distance,
      }));
    } catch (error) {
      log.error({ err: error }, "Vector search error");
      return [];
    }
  }

  private keywordSearch(query: string, limit: number): ToolSearchResult[] {
    const safeQuery = escapeFts5Query(query);
    if (!safeQuery) return [];

    try {
      const rows = this.db
        .prepare(
          `
          SELECT ti.name, ti.description, rank as score
          FROM tool_index_fts tf
          JOIN tool_index ti ON ti.rowid = tf.rowid
          WHERE tool_index_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `
        )
        .all(safeQuery, limit) as Array<{
        name: string;
        description: string;
        score: number;
      }>;

      return rows.map((row) => ({
        name: row.name,
        description: row.description,
        score: bm25ToScore(row.score),
        keywordScore: bm25ToScore(row.score),
      }));
    } catch (error) {
      log.error({ err: error }, "FTS5 search error");
      return [];
    }
  }

  private mergeResults(
    vectorResults: ToolSearchResult[],
    keywordResults: ToolSearchResult[],
    limit: number
  ): ToolSearchResult[] {
    const byName = new Map<string, ToolSearchResult>();

    // When vector search returns nothing (no embedder configured),
    // normalize keyword scores to full weight instead of 0.4
    const hasVectorResults = vectorResults.length > 0;
    const effectiveKeywordWeight = hasVectorResults ? TOOL_RAG_KEYWORD_WEIGHT : 1.0;
    const effectiveVectorWeight = hasVectorResults ? TOOL_RAG_VECTOR_WEIGHT : 0;

    for (const r of vectorResults) {
      byName.set(r.name, { ...r, vectorScore: r.score });
    }

    for (const r of keywordResults) {
      const existing = byName.get(r.name);
      if (existing) {
        existing.keywordScore = r.keywordScore;
        existing.score =
          effectiveVectorWeight * (existing.vectorScore ?? 0) +
          effectiveKeywordWeight * (r.keywordScore ?? 0);
      } else {
        byName.set(r.name, {
          ...r,
          score: effectiveKeywordWeight * (r.keywordScore ?? 0),
        });
      }
    }

    return Array.from(byName.values())
      .filter((r) => r.score >= TOOL_RAG_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
