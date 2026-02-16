import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "./provider.js";
import { hashText, serializeEmbedding, deserializeEmbedding } from "./index.js";
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

  private hits = 0;
  private misses = 0;
  private ops = 0;

  constructor(
    private inner: EmbeddingProvider,
    private db: Database.Database
  ) {
    this.id = inner.id;
    this.model = inner.model;
    this.dimensions = inner.dimensions;
  }

  private cacheGet(hash: string): { embedding: Buffer | string } | undefined {
    return this.db
      .prepare(
        `SELECT embedding FROM embedding_cache WHERE hash = ? AND model = ? AND provider = ?`
      )
      .get(hash, this.model, this.id) as { embedding: Buffer | string } | undefined;
  }

  private cachePut(hash: string, blob: Buffer): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embedding_cache (hash, embedding, model, provider, dims, created_at, accessed_at)
         VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`
      )
      .run(hash, blob, this.model, this.id, this.dimensions);
  }

  private cacheTouch(hash: string): void {
    this.db
      .prepare(
        `UPDATE embedding_cache SET accessed_at = unixepoch() WHERE hash = ? AND model = ? AND provider = ?`
      )
      .run(hash, this.model, this.id);
  }

  async warmup(): Promise<boolean> {
    return this.inner.warmup?.() ?? true;
  }

  async embedQuery(text: string): Promise<number[]> {
    const hash = hashText(text);

    const row = this.cacheGet(hash);
    if (row) {
      this.hits++;
      this.cacheTouch(hash);
      this.tick();
      return deserializeEmbedding(row.embedding);
    }

    this.misses++;
    const embedding = await this.inner.embedQuery(text);
    this.cachePut(hash, serializeEmbedding(embedding));
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
      const row = this.cacheGet(hashes[i]);

      if (row) {
        this.hits++;
        this.cacheTouch(hashes[i]);
        results[i] = deserializeEmbedding(row.embedding);
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

        if (embedding.length > 0) {
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
      console.log(
        `📊 Embedding cache: ${this.hits} hits, ${this.misses} misses (${rate}% hit rate)`
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
        console.log(`🧹 Embedding cache eviction: removed ${toDelete} entries (${count} total)`);
      }
    } catch (err) {
      console.warn("⚠️ Embedding cache eviction error:", err);
    }
  }
}
