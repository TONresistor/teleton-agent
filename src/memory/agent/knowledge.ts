import type Database from "better-sqlite3";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_CHUNK_SIZE, KNOWLEDGE_CHUNK_OVERLAP } from "../../constants/limits.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import {
  hashText,
  serializeEmbedding,
  deserializeEmbedding,
  embeddingToBlob,
} from "../embeddings/index.js";

export interface KnowledgeChunk {
  id: string;
  source: "memory" | "session" | "learned";
  path: string | null;
  text: string;
  startLine?: number;
  endLine?: number;
  hash: string;
}

/**
 * Index MEMORY.md and memory/*.md files
 */
export class KnowledgeIndexer {
  constructor(
    private db: Database.Database,
    private workspaceDir: string,
    private embedder: EmbeddingProvider,
    private vectorEnabled: boolean
  ) {}

  /**
   * Index all memory files
   */
  async indexAll(): Promise<{ indexed: number; skipped: number }> {
    const files = this.listMemoryFiles();
    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      const wasIndexed = await this.indexFile(file);
      if (wasIndexed) {
        indexed++;
      } else {
        skipped++;
      }
    }

    return { indexed, skipped };
  }

  /**
   * Index a single file
   */
  async indexFile(absPath: string): Promise<boolean> {
    if (!existsSync(absPath) || !absPath.endsWith(".md")) {
      return false;
    }

    const content = readFileSync(absPath, "utf-8");
    const relPath = absPath.replace(this.workspaceDir + "/", "");
    const fileHash = hashText(content);

    // Check if already indexed with same hash
    const existing = this.db
      .prepare(`SELECT hash FROM knowledge WHERE path = ? AND source = 'memory' LIMIT 1`)
      .get(relPath) as { hash: string } | undefined;

    if (existing?.hash === fileHash) {
      return false; // Already up to date
    }

    // Delete old chunks
    this.db.prepare(`DELETE FROM knowledge WHERE path = ? AND source = 'memory'`).run(relPath);

    // Chunk the content
    const chunks = this.chunkMarkdown(content, relPath);

    // Compute embeddings
    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder.embedBatch(texts);

    // Insert chunks
    const insert = this.db.prepare(`
      INSERT INTO knowledge (id, source, path, text, embedding, start_line, end_line, hash)
      VALUES (?, 'memory', ?, ?, ?, ?, ?, ?)
    `);

    const insertVec = this.vectorEnabled
      ? this.db.prepare(`INSERT INTO knowledge_vec (id, embedding) VALUES (?, ?)`)
      : null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i] ?? [];

      insert.run(
        chunk.id,
        chunk.path,
        chunk.text,
        serializeEmbedding(embedding),
        chunk.startLine,
        chunk.endLine,
        chunk.hash
      );

      if (insertVec && embedding.length > 0) {
        insertVec.run(chunk.id, embeddingToBlob(embedding));
      }
    }

    return true;
  }

  /**
   * List all memory files
   */
  private listMemoryFiles(): string[] {
    const files: string[] = [];

    // MEMORY.md at root
    const memoryMd = join(this.workspaceDir, "MEMORY.md");
    if (existsSync(memoryMd)) {
      files.push(memoryMd);
    }

    // memory/*.md
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

  /**
   * Chunk markdown content
   */
  private chunkMarkdown(content: string, path: string): KnowledgeChunk[] {
    const lines = content.split("\n");
    const chunks: KnowledgeChunk[] = [];
    const chunkSize = KNOWLEDGE_CHUNK_SIZE;
    const overlap = KNOWLEDGE_CHUNK_OVERLAP;

    let currentChunk = "";
    let startLine = 1;
    let currentLine = 1;

    for (const line of lines) {
      currentChunk += line + "\n";

      if (currentChunk.length >= chunkSize) {
        const text = currentChunk.trim();
        if (text.length > 0) {
          chunks.push({
            id: hashText(`${path}:${startLine}:${currentLine}`),
            source: "memory",
            path,
            text,
            startLine,
            endLine: currentLine,
            hash: hashText(text),
          });
        }

        // Overlap: keep last N chars
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText;
        startLine = currentLine + 1;
      }

      currentLine++;
    }

    // Last chunk
    const text = currentChunk.trim();
    if (text.length > 0) {
      chunks.push({
        id: hashText(`${path}:${startLine}:${currentLine}`),
        source: "memory",
        path,
        text,
        startLine,
        endLine: currentLine,
        hash: hashText(text),
      });
    }

    return chunks;
  }
}
