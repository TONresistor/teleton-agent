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
import {
  rankNamespacesLexically,
  type NamespaceSearchResult,
  type ToolNamespaceCatalogEntry,
} from "./tool-namespaces.js";

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
  private toolEmbeddings = new Map<string, number[]>();
  private namespaceEmbeddingCache: {
    fingerprint: string;
    embeddings: Map<string, number[]>;
  } | null = null;
  private namespaceEmbeddingBuild: {
    fingerprint: string;
    promise: Promise<Map<string, number[]>>;
  } | null = null;
  private reindexQueue: Promise<void> = Promise.resolve();
  private pendingReindexes = 0;
  private deltaIndexHealthy = true;

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

      const nextToolEmbeddings = new Map<string, number[]>();
      for (let index = 0; index < entries.length; index++) {
        const embedding = embeddings[index];
        if (embedding?.length > 0) nextToolEmbeddings.set(entries[index].name, embedding);
      }
      this.toolEmbeddings = nextToolEmbeddings;

      this.deltaIndexHealthy = true;
      this._isIndexed = true;
      return entries.length;
    } catch (error) {
      log.error({ err: error }, "Indexing failed");
      this.deltaIndexHealthy = false;
      this._isIndexed = false;
      return 0;
    }
  }

  /**
   * Delta update for hot-reload plugins.
   */
  reindexTools(removed: string[], added: PiAiTool[]): Promise<void> {
    this.pendingReindexes++;
    this._isIndexed = false;
    const operation = this.reindexQueue
      .then(async () => {
        const succeeded = await this.performReindexTools(removed, added);
        if (!succeeded) this.deltaIndexHealthy = false;
      })
      .finally(() => {
        this.pendingReindexes--;
        if (this.pendingReindexes === 0) this._isIndexed = this.deltaIndexHealthy;
      });
    // A failed update must not poison later hot reload queue execution.
    this.reindexQueue = operation.catch(() => undefined);
    return operation;
  }

  private async performReindexTools(removed: string[], added: PiAiTool[]): Promise<boolean> {
    try {
      const entries = added.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        searchText: `${t.name} — ${t.description ?? ""}`,
      }));
      const embeddings =
        this.vectorEnabled && this.embedder.dimensions > 0 && entries.length > 0
          ? await this.embedder.embedBatch(entries.map((e) => e.searchText))
          : [];

      const deleteTool = this.db.prepare(`DELETE FROM tool_index WHERE name = ?`);
      const insertTool = this.db.prepare(`
        INSERT OR REPLACE INTO tool_index (name, description, search_text, updated_at)
        VALUES (?, ?, ?, unixepoch())
      `);
      // vec0 virtual tables don't support OR REPLACE — delete first, then insert.
      const deleteVec = this.vectorEnabled
        ? this.db.prepare(`DELETE FROM tool_index_vec WHERE name = ?`)
        : null;
      const insertVec = this.vectorEnabled
        ? this.db.prepare(`INSERT INTO tool_index_vec (name, embedding) VALUES (?, ?)`)
        : null;

      const txn = this.db.transaction(() => {
        for (const name of removed) {
          deleteTool.run(name);
          deleteVec?.run(name);
        }
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index];
          insertTool.run(entry.name, entry.description, entry.searchText);
          deleteVec?.run(entry.name);
          if (insertVec && embeddings[index]?.length > 0) {
            insertVec.run(entry.name, serializeEmbedding(embeddings[index]));
          }
        }
      });
      txn();

      for (const name of removed) this.toolEmbeddings.delete(name);
      for (let index = 0; index < entries.length; index++) {
        const embedding = embeddings[index];
        if (embedding?.length > 0) this.toolEmbeddings.set(entries[index].name, embedding);
        else this.toolEmbeddings.delete(entries[index].name);
      }

      log.info(`Delta reindex: -${removed.length} +${added.length} tools`);
      return true;
    } catch (error) {
      log.error({ err: error }, "Delta reindex failed");
      // The transaction is atomic, but the registry has already moved to the new
      // tool set. Never serve a stale persistent index as authoritative: lexical
      // routing over the live registry remains available until the next full index.
      return false;
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
   * First-stage hierarchical routing over compact namespace cards. Namespace
   * embeddings are cached in memory and rebuilt only when the live catalog changes.
   */
  async searchNamespaces(
    query: string,
    queryEmbedding: number[],
    catalog: ToolNamespaceCatalogEntry[],
    limit = 3
  ): Promise<NamespaceSearchResult[]> {
    if (catalog.length === 0 || limit <= 0) return [];

    const lexical = rankNamespacesLexically(query, catalog, catalog.length);
    const lexicalByName = new Map(lexical.map((entry) => [entry.name, entry]));
    let vectorByName = new Map<string, number>();

    if (this.vectorEnabled && queryEmbedding.length > 0 && this.embedder.dimensions > 0) {
      try {
        const embeddings = await this.getNamespaceEmbeddings(catalog);
        vectorByName = new Map(
          catalog
            .map((entry) => {
              const embedding = embeddings.get(entry.name);
              return [
                entry.name,
                embedding ? cosineSimilarity(queryEmbedding, embedding) : 0,
              ] as const;
            })
            .filter(([, score]) => score > 0)
        );
      } catch (error) {
        log.warn({ err: error }, "Namespace embedding failed, using lexical routing");
      }
    }

    const hasVector = vectorByName.size > 0;
    const hasLexical = lexicalByName.size > 0;
    return catalog
      .map((entry): NamespaceSearchResult => {
        const vectorScore = vectorByName.get(entry.name);
        const keywordScore = lexicalByName.get(entry.name)?.keywordScore;
        const score =
          hasVector && hasLexical
            ? TOOL_RAG_VECTOR_WEIGHT * (vectorScore ?? 0) +
              TOOL_RAG_KEYWORD_WEIGHT * (keywordScore ?? 0)
            : hasVector
              ? (vectorScore ?? 0)
              : (keywordScore ?? 0);
        return {
          ...entry,
          score,
          ...(vectorScore !== undefined ? { vectorScore } : {}),
          ...(keywordScore !== undefined ? { keywordScore } : {}),
        };
      })
      .filter((entry) => entry.score >= TOOL_RAG_MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * Second-stage search restricted to the tools exposed by selected namespaces.
   * The candidate set is intentionally small (normally <= 30 tools), so ranking
   * in memory avoids global top-k results crowding out the chosen namespace.
   */
  async searchWithin(
    query: string,
    queryEmbedding: number[],
    allowedNames: ReadonlySet<string>,
    limit: number
  ): Promise<ToolSearchResult[]> {
    if (allowedNames.size === 0 || limit <= 0) return [];

    const candidates = this.getIndexedCandidates(allowedNames);
    if (candidates.length === 0) return [];

    const vectorResults =
      this.vectorEnabled && queryEmbedding.length > 0
        ? candidates
            .map((candidate) => {
              const embedding = this.toolEmbeddings.get(candidate.name);
              const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
              return {
                name: candidate.name,
                description: candidate.description,
                score,
                vectorScore: score,
              } satisfies ToolSearchResult;
            })
            .filter((result) => result.score > 0)
        : [];

    const keywordResults = lexicalToolSearch(query, candidates);
    return this.mergeResults(vectorResults, keywordResults, limit);
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

  private async getNamespaceEmbeddings(
    catalog: ToolNamespaceCatalogEntry[]
  ): Promise<Map<string, number[]>> {
    const fingerprint = catalog
      .map((entry) => `${entry.name}\u0000${entry.searchText}`)
      .join("\u0001");
    if (this.namespaceEmbeddingCache?.fingerprint === fingerprint) {
      return this.namespaceEmbeddingCache.embeddings;
    }
    if (this.namespaceEmbeddingBuild?.fingerprint === fingerprint) {
      return this.namespaceEmbeddingBuild.promise;
    }

    const promise = this.embedder
      .embedBatch(catalog.map((entry) => entry.searchText))
      .then((vectors) => {
        const embeddings = new Map<string, number[]>();
        for (let index = 0; index < catalog.length; index++) {
          const vector = vectors[index];
          if (vector?.length > 0) embeddings.set(catalog[index].name, vector);
        }
        this.namespaceEmbeddingCache = { fingerprint, embeddings };
        return embeddings;
      })
      .finally(() => {
        if (this.namespaceEmbeddingBuild?.fingerprint === fingerprint) {
          this.namespaceEmbeddingBuild = null;
        }
      });
    this.namespaceEmbeddingBuild = { fingerprint, promise };
    return promise;
  }

  private getIndexedCandidates(allowedNames: ReadonlySet<string>): Array<{
    name: string;
    description: string;
    searchText: string;
  }> {
    const names = [...allowedNames];
    const placeholders = names.map(() => "?").join(", ");
    try {
      return this.db
        .prepare(
          `SELECT name, description, search_text AS searchText
           FROM tool_index
           WHERE name IN (${placeholders})`
        )
        .all(...names) as Array<{ name: string; description: string; searchText: string }>;
    } catch (error) {
      log.warn({ err: error }, "Namespace tool lookup failed");
      return [];
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function lexicalToolSearch(
  query: string,
  candidates: Array<{ name: string; description: string; searchText: string }>
): ToolSearchResult[] {
  const queryTokens = new Set(searchTokens(query));
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return candidates
    .map((candidate) => {
      const candidateTokens = new Set(searchTokens(candidate.searchText));
      let overlap = 0;
      for (const token of queryTokens) if (candidateTokens.has(token)) overlap++;
      const overlapScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
      const exactBoost =
        candidate.name === normalizedQuery || normalizedQuery.includes(candidate.name) ? 0.5 : 0;
      const score = Math.min(1, overlapScore + exactBoost);
      return {
        name: candidate.name,
        description: candidate.description,
        score,
        keywordScore: score,
      } satisfies ToolSearchResult;
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
