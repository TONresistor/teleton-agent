import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../schema.js";
import { MessageStore } from "../feed/messages.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

describe("MessageStore", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureSchema(db);
    db.exec("CREATE TABLE tg_messages_vec (id TEXT PRIMARY KEY, embedding BLOB NOT NULL)");
  });

  afterEach(() => db.close());

  it("keeps identical Telegram message IDs isolated by chat", async () => {
    const embedder = {
      id: "noop",
      model: "none",
      dimensions: 0,
      embedQuery: vi.fn().mockResolvedValue([]),
      embedBatch: vi.fn().mockResolvedValue([]),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, false);

    await store.storeMessage({
      id: "42",
      chatId: "chat-a",
      senderId: null,
      text: "first",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 1,
    });
    await store.storeMessage({
      id: "42",
      chatId: "chat-b",
      senderId: null,
      text: "second",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 2,
    });

    expect(db.prepare("SELECT chat_id, id, text FROM tg_messages ORDER BY chat_id").all()).toEqual([
      { chat_id: "chat-a", id: "42", text: "first" },
      { chat_id: "chat-b", id: "42", text: "second" },
    ]);
  });

  it("persists the raw message when embedding generation fails", async () => {
    const embedder = {
      id: "broken",
      model: "broken",
      dimensions: 3,
      embedQuery: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
      embedBatch: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, true);

    await expect(
      store.storeMessage({
        id: "7",
        chatId: "chat-a",
        senderId: null,
        text: "durable first",
        isFromAgent: false,
        hasMedia: false,
        timestamp: 3,
      })
    ).resolves.toBeUndefined();

    expect(
      db
        .prepare("SELECT text, embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "7")
    ).toEqual({ text: "durable first", embedding_status: "failed" });
  });

  it("persists the raw message when vector storage is unavailable", async () => {
    db.exec("DROP TABLE tg_messages_vec");
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    } satisfies EmbeddingProvider;

    await expect(
      new MessageStore(db, embedder, true).storeMessage({
        id: "9",
        chatId: "chat-a",
        senderId: null,
        text: "survive vector failure",
        isFromAgent: false,
        hasMedia: false,
        timestamp: 5,
      })
    ).resolves.toBeUndefined();

    expect(
      db
        .prepare("SELECT text, embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "9")
    ).toEqual({ text: "survive vector failure", embedding_status: "failed" });
    expect(embedder.embedQuery).not.toHaveBeenCalled();
  });

  it("backfills failed message embeddings on a later healthy startup", async () => {
    const broken = {
      id: "broken",
      model: "broken",
      dimensions: 3,
      embedQuery: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
      embedBatch: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
    } satisfies EmbeddingProvider;
    await new MessageStore(db, broken, true).storeMessage({
      id: "8",
      chatId: "chat-a",
      senderId: null,
      text: "retry me",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 4,
    });

    const healthy = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    } satisfies EmbeddingProvider;
    const result = await new MessageStore(db, healthy, true).backfillPendingEmbeddings();

    expect(result).toEqual({ indexed: 1, failed: 0 });
    expect(
      db
        .prepare("SELECT embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "8")
    ).toEqual({ embedding_status: "ready" });
    expect(db.prepare("SELECT id FROM tg_messages_vec").get()).toEqual({ id: "chat-a\u001f8" });
  });
});
