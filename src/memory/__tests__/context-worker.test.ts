import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { ContextBuilder } from "../search/context.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { VectorSearchWorkerClient } from "../workers/vector-search-client.js";

describe("ContextBuilder worker retrieval", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("excludes the current message and deduplicates local/global results", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('current', 'group')").run();
    const insert = db.prepare(
      `INSERT INTO tg_messages
         (id, chat_id, text, embedding_status, is_from_agent, timestamp)
       VALUES (?, 'current', ?, 'disabled', ?, ?)`
    );
    insert.run("previous", "Recent message", 0, 1);
    insert.run("current-id", "Current request", 0, 2);

    const embedder = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn().mockResolvedValue([1, 0]),
      embedBatch: vi.fn(),
    } satisfies EmbeddingProvider;
    const search = vi.fn().mockResolvedValue({
      knowledge: [{ id: "knowledge", text: "Known fact", source: "memory", score: 1 }],
      currentChat: [
        { id: "current\u001fprevious", text: "Recent message", source: "current", score: 1 },
        { id: "current\u001flocal", text: "Unique local", source: "current", score: 0.9 },
      ],
      otherChats: [
        { id: "other\u001fduplicate", text: " unique   LOCAL ", source: "other", score: 0.8 },
        { id: "other\u001fglobal", text: "Unique global", source: "other", score: 0.7 },
      ],
      timingsMs: { knowledge: 1, currentChat: 1, otherChats: 1, total: 3 },
    });
    const worker = { search } as unknown as VectorSearchWorkerClient;
    const builder = new ContextBuilder(db, embedder, true, worker);

    const context = await builder.buildContext({
      query: "Current request",
      queryEmbedding: [1, 0],
      chatId: "current",
      currentMessageId: "current-id",
      searchAllChats: true,
      maxRecentMessages: 10,
      maxRelevantChunks: 5,
    });

    expect(context.recentMessages).toEqual([{ role: "user", content: "Recent message" }]);
    expect(context.relevantFeed).toEqual(["Unique local", "[From chat other]: Unique global"]);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ currentMessageId: "current-id" })
    );
  });

  it("falls back to FTS when the vector worker fails", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('current', 'group')").run();
    db.prepare(
      `INSERT INTO tg_messages
         (id, chat_id, text, embedding_status, is_from_agent, timestamp)
       VALUES ('history', 'current', 'historical fallback result', 'disabled', 0, 1)`
    ).run();
    const embedder = {
      id: "test",
      model: "test",
      dimensions: 2,
      embedQuery: vi.fn().mockResolvedValue([1, 0]),
      embedBatch: vi.fn(),
    } satisfies EmbeddingProvider;
    const worker = {
      search: vi.fn().mockRejectedValue(new Error("worker unavailable")),
    } as unknown as VectorSearchWorkerClient;
    const builder = new ContextBuilder(db, embedder, true, worker);

    const context = await builder.buildContext({
      query: "historical fallback",
      queryEmbedding: [1, 0],
      chatId: "current",
      maxRecentMessages: 0,
      includeAgentMemory: false,
    });

    expect(context.relevantFeed).toEqual(["historical fallback result"]);
  });
});
