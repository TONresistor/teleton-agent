import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { CachedEmbeddingProvider } from "../embeddings/cached.js";
import { hashText } from "../embeddings/utils.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

describe("CachedEmbeddingProvider", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("regenerates an invalid cached embedding", async () => {
    const inner = {
      id: "local",
      model: "test-model",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn(),
    } satisfies EmbeddingProvider;
    db.prepare(
      `INSERT INTO embedding_cache (hash, model, provider, embedding, dims)
       VALUES (?, ?, ?, ?, ?)`
    ).run(hashText("hello"), inner.model, inner.id, Buffer.alloc(0), inner.dimensions);

    const result = await new CachedEmbeddingProvider(inner, db).embedQuery("hello");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(inner.embedQuery).toHaveBeenCalledOnce();
    expect(
      db
        .prepare("SELECT length(embedding) AS bytes FROM embedding_cache WHERE hash = ?")
        .get(hashText("hello"))
    ).toEqual({ bytes: 12 });
  });

  it("does not cache an unavailable embedding", async () => {
    const inner = {
      id: "local",
      model: "test-model",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([]),
      embedBatch: vi.fn(),
    } satisfies EmbeddingProvider;

    await expect(new CachedEmbeddingProvider(inner, db).embedQuery("hello")).resolves.toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM embedding_cache").get()).toEqual({ count: 0 });
  });
});
