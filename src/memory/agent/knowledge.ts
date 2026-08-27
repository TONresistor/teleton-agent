import type Database from "better-sqlite3";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_CHUNK_SIZE } from "../../constants/limits.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { hashText, serializeEmbedding } from "../embeddings/index.js";
import { HybridSearch, type HybridSearchResult } from "../search/hybrid.js";
import type { VectorSearchWorkerClient } from "../workers/vector-search-client.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Memory");

export interface KnowledgeChunk {
  id: string;
  source: "memory" | "session" | "learned";
  path: string | null;
  text: string;
  startLine?: number;
  endLine?: number;
  hash: string;
}

let _instance: KnowledgeIndexer | null = null;

export function setKnowledgeIndexer(indexer: KnowledgeIndexer): void {
  _instance = indexer;
}

export function getKnowledgeIndexer(): KnowledgeIndexer | null {
  return _instance;
}

export class KnowledgeIndexer {
  constructor(
    private db: Database.Database,
    private workspaceDir: string,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean,
    private vectorSearchWorker?: VectorSearchWorkerClient
  ) {}

  getEmbedder(): EmbeddingProvider {
    return this.embedder;
  }

  async search(
    query: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<HybridSearchResult[]> {
    if (this.vectorSearchWorker && queryEmbedding.length > 0) {
      try {
        const results = await this.vectorSearchWorker.searchKnowledge({
          type: "searchKnowledge",
          query,
          queryEmbedding,
          limit,
        });
        this.trackAccess(results);
        return results;
      } catch (error) {
        log.warn({ err: error }, "Knowledge vector worker failed; falling back to FTS");
      }
    }

    const search = new HybridSearch(this.db, this.vectorSearchWorker ? false : this.vectorEnabled);
    return search.searchKnowledge(query, queryEmbedding, { limit });
  }

  async indexAll(options?: { force?: boolean }): Promise<{ indexed: number; skipped: number }> {
    const files = this.listMemoryFiles();
    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      const wasIndexed = await this.indexFile(file, options?.force);
      if (wasIndexed) {
        indexed++;
      } else {
        skipped++;
      }
    }

    return { indexed, skipped };
  }

  async indexFile(absPath: string, force?: boolean): Promise<boolean> {
    if (!existsSync(absPath) || !absPath.endsWith(".md")) {
      return false;
    }

    const content = readFileSync(absPath, "utf-8");
    const relPath = absPath.replace(this.workspaceDir + "/", "");
    const fileHash = hashText(content);

    if (!force) {
      const existing = this.db
        .prepare(`SELECT hash FROM knowledge WHERE path = ? AND source = 'memory' LIMIT 1`)
        .get(relPath) as { hash: string } | undefined;

      if (existing?.hash === fileHash) {
        return false;
      }
    }

    const chunks = this.chunkMarkdown(content, relPath);
    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder.embedBatch(texts);

    // Semantic dedup: check new chunks against existing chunks from OTHER paths.
    // All embeddings are already computed above (batch) — no extra embed calls here.
    const chunksToInsert: Array<{ chunk: KnowledgeChunk; embedding: number[] }> = [];
    const idsToSupersede: string[] = [];

    if (this.vectorEnabled) {
      const vecQuery = this.db.prepare(`
        SELECT kv.id, kv.distance
        FROM (
          SELECT id, distance
          FROM knowledge_vec
          WHERE embedding MATCH ? AND k = 5
        ) kv
        JOIN knowledge k ON k.id = kv.id
        WHERE k.path != ? AND (k.status = 'active' OR k.status IS NULL)
        ORDER BY kv.distance
      `);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i] ?? [];

        if (embedding.length === 0) {
          chunksToInsert.push({ chunk, embedding });
          continue;
        }

        let skip = false;
        try {
          const similar = vecQuery.all(serializeEmbedding(embedding), relPath) as Array<{
            id: string;
            distance: number;
          }>;

          // cosine distance < 0.1 → similarity > 0.9 → exact semantic duplicate, skip
          const exactDup = similar.find((r) => r.distance < 0.1);
          if (exactDup) {
            skip = true;
          } else {
            // cosine distance < 0.15 → similarity > 0.85 → prefer fresh content, supersede old
            const nearDup = similar.find((r) => r.distance < 0.15);
            if (nearDup) {
              idsToSupersede.push(nearDup.id);
            }
          }
        } catch {
          // vec query failed — insert normally
        }

        if (!skip) {
          chunksToInsert.push({ chunk, embedding });
        }
      }
    } else {
      for (let i = 0; i < chunks.length; i++) {
        chunksToInsert.push({ chunk: chunks[i], embedding: embeddings[i] ?? [] });
      }
    }

    this.db.transaction(() => {
      if (this.vectorEnabled) {
        this.db
          .prepare(
            `DELETE FROM knowledge_vec WHERE id IN (
              SELECT id FROM knowledge WHERE path = ? AND source = 'memory'
            )`
          )
          .run(relPath);
      }
      this.db.prepare(`DELETE FROM knowledge WHERE path = ? AND source = 'memory'`).run(relPath);

      // Mark superseded chunks from other paths
      if (idsToSupersede.length > 0) {
        const placeholders = idsToSupersede.map(() => "?").join(", ");
        this.db
          .prepare(
            `UPDATE knowledge SET status = 'superseded', updated_at = unixepoch() WHERE id IN (${placeholders})`
          )
          .run(...idsToSupersede);
      }

      const insert = this.db.prepare(`
        INSERT INTO knowledge (id, source, path, text, embedding, start_line, end_line, hash, status, memory_type)
        VALUES (?, 'memory', ?, ?, ?, ?, ?, ?, 'active', ?)
      `);

      const insertVec = this.vectorEnabled
        ? this.db.prepare(`INSERT INTO knowledge_vec (id, embedding) VALUES (?, ?)`)
        : null;

      const memoryType = this.getMemoryType(relPath);

      for (const { chunk, embedding } of chunksToInsert) {
        insert.run(
          chunk.id,
          chunk.path,
          chunk.text,
          serializeEmbedding(embedding),
          chunk.startLine,
          chunk.endLine,
          fileHash,
          memoryType
        );

        if (insertVec && embedding.length > 0) {
          insertVec.run(chunk.id, serializeEmbedding(embedding));
        }
      }
    })();

    return true;
  }

  async pruneOrphans(): Promise<{ markedInactive: number; deleted: number }> {
    // Find all active memory chunks pointing to files that no longer exist
    const paths = this.db
      .prepare(
        `SELECT DISTINCT path FROM knowledge WHERE path IS NOT NULL AND source = 'memory'
         AND (status = 'active' OR status IS NULL)`
      )
      .all() as Array<{ path: string }>;

    let markedInactive = 0;

    const orphanedPaths: string[] = [];
    for (const { path } of paths) {
      const absPath = join(this.workspaceDir, path);
      // Also check archived/ — consolidated files are moved there, keep their chunks searchable
      const archivedPath = join(
        this.workspaceDir,
        "memory",
        "archived",
        path.replace(/^memory\//, "")
      );
      if (!existsSync(absPath) && !existsSync(archivedPath)) {
        orphanedPaths.push(path);
      }
    }

    if (orphanedPaths.length > 0) {
      const ph = orphanedPaths.map(() => "?").join(", ");
      const result = this.db
        .prepare(
          `UPDATE knowledge SET status = 'inactive', updated_at = unixepoch()
           WHERE path IN (${ph}) AND source = 'memory'`
        )
        .run(...orphanedPaths);
      markedInactive = result.changes;
    }

    // Delete chunks inactive for > 30 days
    const staleIds = this.db
      .prepare(
        `SELECT id FROM knowledge WHERE status = 'inactive' AND updated_at < unixepoch() - ?`
      )
      .all(30 * 86400) as Array<{ id: string }>;

    let deleted = 0;
    if (staleIds.length > 0) {
      const ids = staleIds.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(", ");
      this.db.transaction(() => {
        if (this.vectorEnabled) {
          this.db.prepare(`DELETE FROM knowledge_vec WHERE id IN (${placeholders})`).run(...ids);
        }
        this.db.prepare(`DELETE FROM knowledge WHERE id IN (${placeholders})`).run(...ids);
      })();
      deleted = ids.length;
    }

    return { markedInactive, deleted };
  }

  private listMemoryFiles(): string[] {
    const files: string[] = [];

    const memoryMd = join(this.workspaceDir, "MEMORY.md");
    if (existsSync(memoryMd)) {
      files.push(memoryMd);
    }

    const memoryDir = join(this.workspaceDir, "memory");
    if (existsSync(memoryDir)) {
      const entries = readdirSync(memoryDir);
      for (const entry of entries) {
        const absPath = join(memoryDir, entry);
        if (statSync(absPath).isFile() && entry.endsWith(".md")) {
          files.push(absPath);
        }
      }
    }

    return files;
  }

  private getMemoryType(relPath: string): "semantic" | "episodic" | "procedural" {
    if (relPath === "MEMORY.md") return "procedural";
    if (/^memory\/(\d{4}-\d{2}-\d{2}|consolidated-)/.test(relPath)) return "episodic";
    return "semantic";
  }

  private trackAccess(results: HybridSearchResult[]): void {
    if (results.length === 0) return;
    const ids = results.map((result) => result.id);
    setImmediate(() => {
      try {
        const placeholders = ids.map(() => "?").join(", ");
        this.db
          .prepare(
            `UPDATE knowledge SET access_count = access_count + 1, last_accessed_at = unixepoch()
             WHERE id IN (${placeholders})`
          )
          .run(...ids);
      } catch {
        // Access metadata is best-effort and must not affect search results.
      }
    });
  }

  /**
   * Chunk markdown content with structure awareness.
   * Respects heading boundaries, code blocks, and list groups.
   * Target: KNOWLEDGE_CHUNK_SIZE chars, hard max: 2x target.
   */
  private chunkMarkdown(content: string, path: string): KnowledgeChunk[] {
    const lines = content.split("\n");
    const chunks: KnowledgeChunk[] = [];
    const targetSize = KNOWLEDGE_CHUNK_SIZE;
    const hardMax = targetSize * 2;

    let currentChunk = "";
    let startLine = 1;
    let currentLine = 1;
    let inCodeBlock = false;
    let overlapPrefix = "";

    const flushChunk = () => {
      const text = currentChunk.trim();
      if (text.length > 0) {
        chunks.push({
          id: hashText(`${path}:${startLine}:${currentLine - 1}`),
          source: "memory",
          path,
          text,
          startLine,
          endLine: currentLine - 1,
          hash: hashText(text),
        });
        const nonEmpty = text.split("\n").filter((l) => l.trim());
        overlapPrefix = nonEmpty.length > 0 ? nonEmpty.slice(-2).join("\n") + "\n" : "";
      }
      currentChunk = overlapPrefix;
      startLine = currentLine;
    };

    for (const line of lines) {
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
      }

      if (!inCodeBlock && currentChunk.length >= targetSize) {
        const isHeading = /^#{1,6}\s/.test(line);
        const isBlankLine = line.trim() === "";
        const isHorizontalRule = /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());

        if (isHeading) {
          flushChunk();
        } else if ((isBlankLine || isHorizontalRule) && currentChunk.length >= targetSize) {
          currentChunk += line + "\n";
          currentLine++;
          flushChunk();
          continue;
        } else if (currentChunk.length >= hardMax) {
          flushChunk();
        }
      }

      currentChunk += line + "\n";
      currentLine++;
    }

    flushChunk();
    return chunks;
  }
}
