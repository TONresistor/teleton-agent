import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "./provider.js";
import { hashText, isValidEmbedding, serializeEmbedding, deserializeEmbedding } from "./utils.js";
import { createLogger } from "../../utils/logger.js";
import {
  EMBEDDING_CACHE_MAX_ENTRIES,
  EMBEDDING_CACHE_TTL_DAYS,
  EMBEDDING_CACHE_EVICTION_INTERVAL,
  EMBEDDING_CACHE_EVICTION_RATIO,
} from "../../constants/limits.js";

/**
 * Caching decorator for any EmbeddingProvider.
 * Transparently caches embeddings in SQLite.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;

  private static readonly log = createLogger("Memory");
  private hits = 0;
  private misses = 0;
  private ops = 0;
  private readonly stmtCacheGet: Database.Statement;
  private readonly stmtCachePut: Database.Statement;
  private readonly stmtCacheTouch: Database.Statement;
  private readonly stmtCacheDelete: Database.Statement;

  constructor(
    private inner: EmbeddingProvider,
    private db: Database.Database
  ) {
    this.id = inner.id;
    this.model = inner.model;
    this.dimensions = inner.dimensions;
    this.stmtCacheGet = db.prepare(
      `SELECT embedding, dims FROM embedding_cache WHERE hash = ? AND model = ? AND provider = ?`
    );
    this.stmtCachePut = db.prepare(
      `INSERT OR REPLACE INTO embedding_cache (hash, embedding, model, provider, dims, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    );
    this.stmtCacheTouch = db.prepare(
      `UPDATE embedding_cache SET accessed_at = unixepoch() WHERE hash = ? AND model = ? AND provider = ?`
    );
    this.stmtCacheDelete = db.prepare(
      `DELETE FROM embedding_cache WHERE hash = ? AND model = ? AND provider = ?`
    );
  }

  private cacheGet(hash: string): { embedding: Buffer | string; dims: number } | undefined {
    return this.stmtCacheGet.get(hash, this.model, this.id) as
      | { embedding: Buffer | string; dims: number }
      | undefined;
  }

  private getValidCachedEmbedding(hash: string): number[] | undefined {
    const row = this.cacheGet(hash);
    if (!row) return undefined;

    const embedding = deserializeEmbedding(row.embedding);
    if (row.dims === this.dimensions && isValidEmbedding(embedding, this.dimensions)) {
      return embedding;
    }

    this.stmtCacheDelete.run(hash, this.model, this.id);
    return undefined;
  }

  private cachePut(hash: string, blob: Buffer): void {
    this.stmtCachePut.run(hash, blob, this.model, this.id, this.dimensions);
  }

  private cacheTouch(hash: string): void {
    this.stmtCacheTouch.run(hash, this.model, this.id);
  }

  async warmup(): Promise<boolean> {
    return this.inner.warmup?.() ?? true;
  }

  async embedQuery(text: string): Promise<number[]> {
    const hash = hashText(text);

    const cached = this.getValidCachedEmbedding(hash);
    if (cached) {
      this.hits++;
      this.cacheTouch(hash);
      this.tick();
      return cached;
    }

    this.misses++;
    const embedding = await this.inner.embedQuery(text);
    if (isValidEmbedding(embedding, this.dimensions)) {
      this.cachePut(hash, serializeEmbedding(embedding));
    }
    this.tick();
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const hashes = texts.map(hashText);
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const missIndices: number[] = [];
    const missTexts: string[] = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const cached = this.getValidCachedEmbedding(hashes[i]);

      if (cached) {
        this.hits++;
        this.cacheTouch(hashes[i]);
        results[i] = cached;
      } else {
        this.misses++;
        missIndices.push(i);
        missTexts.push(texts[i]);
      }
    }

    if (missTexts.length > 0) {
      const newEmbeddings = await this.inner.embedBatch(missTexts);

      for (let j = 0; j < missIndices.length; j++) {
        const idx = missIndices[j];
        const embedding = newEmbeddings[j] ?? [];
        results[idx] = embedding;

        if (isValidEmbedding(embedding, this.dimensions)) {
          this.cachePut(hashes[idx], serializeEmbedding(embedding));
        }
      }
    }

    this.ops += texts.length;
    this.maybeEvict();
    this.maybeLogStats();

    return results as number[][];
  }

  private tick(): void {
    this.ops++;
    this.maybeEvict();
    this.maybeLogStats();
  }

  private maybeLogStats(): void {
    const total = this.hits + this.misses;
    if (total > 0 && total % 100 === 0) {
      const rate = ((this.hits / total) * 100).toFixed(0);
      CachedEmbeddingProvider.log.info(
        `Embedding cache: ${this.hits} hits, ${this.misses} misses (${rate}% hit rate)`
      );
    }
  }

  private maybeEvict(): void {
    if (this.ops % EMBEDDING_CACHE_EVICTION_INTERVAL !== 0) return;

    try {
      const cutoff = Math.floor(Date.now() / 1000) - EMBEDDING_CACHE_TTL_DAYS * 86400;
      this.db.prepare(`DELETE FROM embedding_cache WHERE accessed_at < ?`).run(cutoff);

      const count = (
        this.db.prepare(`SELECT COUNT(*) as cnt FROM embedding_cache`).get() as { cnt: number }
      ).cnt;

      if (count > EMBEDDING_CACHE_MAX_ENTRIES) {
        const toDelete = Math.ceil(count * EMBEDDING_CACHE_EVICTION_RATIO);
        this.db
          .prepare(
            `DELETE FROM embedding_cache WHERE (hash, model, provider) IN (
              SELECT hash, model, provider FROM embedding_cache ORDER BY accessed_at ASC LIMIT ?
            )`
          )
          .run(toDelete);
        CachedEmbeddingProvider.log.info(
          `Embedding cache eviction: removed ${toDelete} entries (${count} total)`
        );
      }
    } catch (error) {
      CachedEmbeddingProvider.log.warn({ err: error }, "Embedding cache eviction error");
    }
  }
}
