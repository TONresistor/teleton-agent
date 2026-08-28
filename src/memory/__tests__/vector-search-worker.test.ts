import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeEmbedding } from "../embeddings/index.js";
import { ensureSchema, ensureVectorTables, runMigrations } from "../schema.js";
import { VectorSearchWorkerClient } from "../workers/vector-search-client.js";

describe("VectorSearchWorkerClient", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs knowledge and tool sqlite-vec queries in a real worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teleton-vector-worker-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "memory.db");
    const db = new Database(databasePath);
    ensureSchema(db);
    runMigrations(db);
    sqliteVec.load(db);
    ensureVectorTables(db, 2);
    db.exec(`
      CREATE VIRTUAL TABLE tool_index_vec USING vec0(
        name TEXT PRIMARY KEY,
        embedding FLOAT[2] distance_metric=cosine
      );
    `);
    const embedding = serializeEmbedding([1, 0]);
    db.prepare(
      `INSERT INTO knowledge (id, source, text, embedding, hash)
       VALUES ('chunk', 'memory', 'worker knowledge', ?, 'hash')`
    ).run(embedding);
    db.prepare("INSERT INTO knowledge_vec (id, embedding) VALUES ('chunk', ?)").run(embedding);
    db.prepare(
      `INSERT INTO tool_index (name, description, search_text)
       VALUES ('memory_search', 'Search memory', 'memory search')`
    ).run();
    db.prepare("INSERT INTO tool_index_vec (name, embedding) VALUES ('memory_search', ?)").run(
      embedding
    );
    db.close();

    const worker = new VectorSearchWorkerClient(databasePath);
    try {
      const knowledge = await worker.searchKnowledge({
        type: "searchKnowledge",
        query: "no lexical match",
        queryEmbedding: [1, 0],
        limit: 2,
      });
      const tools = await worker.searchTools({
        type: "searchTools",
        queryEmbedding: [1, 0],
        limit: 2,
      });

      expect(knowledge.map((result) => result.id)).toEqual(["chunk"]);
      expect(tools).toEqual([
        expect.objectContaining({ name: "memory_search", description: "Search memory" }),
      ]);
    } finally {
      await worker.close();
    }
  });
});
