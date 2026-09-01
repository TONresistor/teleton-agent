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
    db.exec(`CREATE TABLE tg_messages_vec (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      message_id TEXT,
      timestamp INTEGER,
      embedding BLOB NOT NULL
    )`);
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
    await store.startPendingEmbeddingBackfill(16, 0);

    expect(
      db
        .prepare("SELECT text, embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "7")
    ).toEqual({ text: "durable first", embedding_status: "failed" });
  });

  it("returns after the durable write without waiting for embedding generation", async () => {
    let resolveEmbeddings!: (embeddings: number[][]) => void;
    const deferred = new Promise<number[][]>((resolve) => {
      resolveEmbeddings = resolve;
    });
    const embedder = {
      id: "slow",
      model: "slow",
      dimensions: 3,
      embedQuery: vi.fn(),
      embedBatch: vi.fn().mockReturnValue(deferred),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, true);

    await store.storeMessage({
      id: "slow-message",
      chatId: "chat-a",
      senderId: null,
      text: "persist before embedding",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 3,
    });

    expect(
      db.prepare("SELECT embedding_status FROM tg_messages WHERE id = 'slow-message'").get()
    ).toEqual({ embedding_status: "pending" });
    expect(embedder.embedBatch).not.toHaveBeenCalled();

    const backfill = store.startPendingEmbeddingBackfill(16, 0);
    expect(embedder.embedBatch).toHaveBeenCalledWith(["persist before embedding"]);

    resolveEmbeddings([[0.1, 0.2, 0.3]]);
    await backfill;
    expect(
      db.prepare("SELECT embedding_status FROM tg_messages WHERE id = 'slow-message'").get()
    ).toEqual({ embedding_status: "ready" });
  });

  it("removes a stale vector when a message is updated without text", async () => {
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi
        .fn()
        .mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))),
    } satisfies EmbeddingProvider;

    const store = new MessageStore(db, embedder, true);
    await store.storeMessage({
      id: "media",
      chatId: "chat-a",
      senderId: null,
      text: "caption",
      isFromAgent: false,
      hasMedia: true,
      mediaType: "photo",
      timestamp: 3,
    });
    await store.startPendingEmbeddingBackfill(16, 0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM tg_messages_vec").get()).toEqual({ count: 1 });

    await store.storeMessage({
      id: "media",
      chatId: "chat-a",
      senderId: null,
      text: "",
      isFromAgent: false,
      hasMedia: true,
      mediaType: "sticker",
      timestamp: 4,
    });

    expect(embedder.embedBatch).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT embedding, embedding_status FROM tg_messages WHERE id = 'media'").get()
    ).toEqual({ embedding: null, embedding_status: "disabled" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM tg_messages_vec").get()).toEqual({ count: 0 });
  });

  it("rejects embeddings with the wrong dimensions before persistence", async () => {
    const embedder = {
      id: "malformed",
      model: "malformed",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1]),
      embedBatch: vi.fn().mockResolvedValue([[0.1]]),
    } satisfies EmbeddingProvider;

    const store = new MessageStore(db, embedder, true);
    await store.storeMessage({
      id: "bad-vector",
      chatId: "chat-a",
      senderId: null,
      text: "do not persist malformed vectors",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 4,
    });
    await store.startPendingEmbeddingBackfill(16, 0);

    expect(
      db
        .prepare("SELECT embedding, embedding_status FROM tg_messages WHERE id = 'bad-vector'")
        .get()
    ).toEqual({ embedding: null, embedding_status: "failed" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM tg_messages_vec").get()).toEqual({ count: 0 });
  });

  it("appends derived media context for later recall", async () => {
    const embedder = {
      id: "noop",
      model: "none",
      dimensions: 0,
      embedQuery: vi.fn().mockResolvedValue([]),
      embedBatch: vi.fn().mockResolvedValue([]),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, false);
    await store.storeMessage({
      id: "media-1",
      chatId: "chat-a",
      senderId: null,
      text: "Look at this",
      isFromAgent: false,
      hasMedia: true,
      mediaType: "photo",
      timestamp: 4,
    });

    await store.appendContext("chat-a", "media-1", "[Media description: a red bicycle]");

    expect(
      db
        .prepare("SELECT id, text FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "media-1:media")
    ).toEqual({ id: "media-1:media", text: "[Media description: a red bicycle]" });
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

    const store = new MessageStore(db, embedder, true);
    await expect(
      store.storeMessage({
        id: "9",
        chatId: "chat-a",
        senderId: null,
        text: "survive vector failure",
        isFromAgent: false,
        hasMedia: false,
        timestamp: 5,
      })
    ).resolves.toBeUndefined();
    await store.startPendingEmbeddingBackfill(16, 0);

    expect(
      db
        .prepare("SELECT text, embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "9")
    ).toEqual({ text: "survive vector failure", embedding_status: "failed" });
    expect(embedder.embedBatch).toHaveBeenCalledTimes(1);
  });

  it("keeps text pending while vector storage is temporarily unavailable", async () => {
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    } satisfies EmbeddingProvider;

    await new MessageStore(db, embedder, false).storeMessage({
      id: "outage",
      chatId: "chat-a",
      senderId: null,
      text: "index after recovery",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 6,
    });

    expect(embedder.embedQuery).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT embedding_status FROM tg_messages WHERE id = 'outage'").get()
    ).toEqual({ embedding_status: "pending" });
    expect(
      db.prepare("SELECT value FROM meta WHERE key = 'tg_messages_vector_rebuild_required'").get()
    ).toEqual({ value: "1" });
  });

  it("backfills failed message embeddings on a later healthy startup", async () => {
    const broken = {
      id: "broken",
      model: "broken",
      dimensions: 3,
      embedQuery: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
      embedBatch: vi.fn().mockRejectedValue(new Error("embedding unavailable")),
    } satisfies EmbeddingProvider;
    const brokenStore = new MessageStore(db, broken, true);
    await brokenStore.storeMessage({
      id: "8",
      chatId: "chat-a",
      senderId: null,
      text: "retry me",
      isFromAgent: false,
      hasMedia: false,
      timestamp: 4,
    });
    await brokenStore.startPendingEmbeddingBackfill(16, 0);

    const healthy = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi
        .fn()
        .mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))),
    } satisfies EmbeddingProvider;
    const result = await new MessageStore(db, healthy, true).backfillPendingEmbeddings();

    expect(result).toEqual({ indexed: 1, failed: 0, skipped: 0 });
    expect(
      db
        .prepare("SELECT embedding_status FROM tg_messages WHERE chat_id = ? AND id = ?")
        .get("chat-a", "8")
    ).toEqual({ embedding_status: "ready" });
    expect(db.prepare("SELECT id FROM tg_messages_vec").get()).toEqual({ id: "chat-a\u001f8" });
  });

  it("recovers the full startup window in bounded batches", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('chat-a', 'group')").run();
    const insert = db.prepare(
      `INSERT INTO tg_messages (id, chat_id, text, embedding_status, timestamp)
       VALUES (?, 'chat-a', ?, 'failed', ?)`
    );
    for (let index = 0; index < 20; index++) {
      insert.run(String(index), `failed-${index}`, index);
    }
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn(),
      embedBatch: vi
        .fn()
        .mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))),
    } satisfies EmbeddingProvider;

    const result = await new MessageStore(db, embedder, true).backfillPendingEmbeddings();

    expect(result).toEqual({ indexed: 20, failed: 0, skipped: 0 });
    expect(embedder.embedBatch).toHaveBeenCalledTimes(2);
    expect(embedder.embedBatch.mock.calls.map(([texts]) => texts.length)).toEqual([16, 4]);
  });

  it("continues pending embedding backfill in bounded background batches", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('chat-a', 'group')").run();
    const insert = db.prepare(
      `INSERT INTO tg_messages (id, chat_id, text, embedding_status, timestamp)
       VALUES (?, 'chat-a', ?, 'pending', ?)`
    );
    insert.run("1", "first", 1);
    insert.run("2", "second", 2);
    insert.run("3", "third", 3);
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi
        .fn()
        .mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))),
    } satisfies EmbeddingProvider;

    await new MessageStore(db, embedder, true).startPendingEmbeddingBackfill(2, 0);

    expect(db.prepare("SELECT COUNT(*) AS count FROM tg_messages_vec").get()).toEqual({ count: 3 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM tg_messages WHERE embedding_status = 'pending'")
        .get()
    ).toEqual({ count: 0 });
  });

  it("discards a backfill result when the message changes during embedding", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('chat-a', 'group')").run();
    db.prepare(
      `INSERT INTO tg_messages (id, chat_id, text, embedding_status, timestamp)
       VALUES ('race', 'chat-a', 'old text', 'pending', 1)`
    ).run();
    let resolveEmbedding!: (embedding: number[][]) => void;
    const deferredEmbedding = new Promise<number[][]>((resolve) => {
      resolveEmbedding = resolve;
    });
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn(),
      embedBatch: vi.fn().mockReturnValue(deferredEmbedding),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, true);

    const backfill = store.backfillPendingEmbeddings();
    expect(embedder.embedBatch).toHaveBeenCalledWith(["old text"]);
    await store.storeMessage({
      id: "race",
      chatId: "chat-a",
      senderId: null,
      text: "",
      isFromAgent: false,
      hasMedia: true,
      mediaType: "photo",
      timestamp: 2,
    });
    resolveEmbedding([[0.1, 0.2, 0.3]]);

    await expect(backfill).resolves.toEqual({ indexed: 0, failed: 0, skipped: 1 });
    expect(
      db
        .prepare("SELECT text, embedding, embedding_status FROM tg_messages WHERE id = 'race'")
        .get()
    ).toEqual({ text: "", embedding: null, embedding_status: "disabled" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM tg_messages_vec").get()).toEqual({ count: 0 });
  });

  it("does not mark an updated message failed when a stale backfill rejects", async () => {
    db.prepare("INSERT INTO tg_chats (id, type) VALUES ('chat-a', 'group')").run();
    db.prepare(
      `INSERT INTO tg_messages (id, chat_id, text, embedding_status, timestamp)
       VALUES ('race-error', 'chat-a', 'old text', 'pending', 1)`
    ).run();
    let rejectEmbedding!: (error: Error) => void;
    const deferredEmbedding = new Promise<number[][]>((_, reject) => {
      rejectEmbedding = reject;
    });
    const embedder = {
      id: "healthy",
      model: "healthy",
      dimensions: 3,
      embedQuery: vi.fn(),
      embedBatch: vi.fn().mockReturnValue(deferredEmbedding),
    } satisfies EmbeddingProvider;
    const store = new MessageStore(db, embedder, true);

    const backfill = store.backfillPendingEmbeddings();
    await store.storeMessage({
      id: "race-error",
      chatId: "chat-a",
      senderId: null,
      text: "",
      isFromAgent: false,
      hasMedia: true,
      mediaType: "photo",
      timestamp: 2,
    });
    rejectEmbedding(new Error("stale embedding failed"));

    await expect(backfill).resolves.toEqual({ indexed: 0, failed: 0, skipped: 1 });
    expect(
      db.prepare("SELECT text, embedding_status FROM tg_messages WHERE id = 'race-error'").get()
    ).toEqual({ text: "", embedding_status: "disabled" });
  });
});
