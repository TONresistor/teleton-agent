import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { KnowledgeIndexer } from "../agent/knowledge.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { ensureSchema } from "../schema.js";
import type { VectorSearchWorkerClient } from "../workers/vector-search-client.js";

describe("KnowledgeIndexer worker retrieval", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("delegates semantic knowledge search to the vector worker", async () => {
    const embedder: EmbeddingProvider = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn(async () => [1, 0]),
      embedBatch: vi.fn(async () => []),
    };
    const expected = [{ id: "chunk", text: "Known fact", source: "memory", score: 0.9 }];
    const searchKnowledge = vi.fn().mockResolvedValue(expected);
    const worker = { searchKnowledge } as unknown as VectorSearchWorkerClient;
    const indexer = new KnowledgeIndexer(db, "/tmp", embedder, true, worker);

    await expect(indexer.search("fact", [1, 0], 5)).resolves.toEqual(expected);
    expect(searchKnowledge).toHaveBeenCalledWith({
      type: "searchKnowledge",
      query: "fact",
      queryEmbedding: [1, 0],
      limit: 5,
    });
  });
});
