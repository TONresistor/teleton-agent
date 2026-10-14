import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase, closeDatabase } from "../database.js";
import { synchronizeEmbeddingIdentity } from "../embedding-identity.js";
import { TaskStore } from "../agent/tasks.js";
import { pruneOldMessages, telegramMessageKey } from "../feed/messages.js";
import { initializeMemory } from "../index.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

vi.mock("../embeddings/local.js", () => ({ LocalEmbeddingProvider: class {} }));
vi.mock("../workers/rpc-client.js", () => ({
  WorkerRpcClient: class {
    close = vi.fn(async () => undefined);
    request = vi.fn();
  },
}));
vi.mock("../workers/vector-search-client.js", () => ({
  VectorSearchWorkerClient: class {
    close = vi.fn(async () => undefined);
  },
}));

const memories: MemoryDatabase[] = [];
function memory(vectorEnabled = true): MemoryDatabase {
  const result = new MemoryDatabase({
    path: ":memory:",
    enableVectorSearch: vectorEnabled,
    vectorDimensions: 3,
  });
  memories.push(result);
  return result;
}

const provider: EmbeddingProvider = {
  id: "local",
  model: "first-model",
  dimensions: 3,
  embedQuery: async () => [1, 0, 0],
  embedBatch: async () => [[1, 0, 0]],
};
const vector = Buffer.from(new Float32Array([1, 0, 0]).buffer);

function seedEmbeddings(database: MemoryDatabase): void {
  const db = database.getDb();
  db.exec("INSERT INTO tg_chats (id, type) VALUES ('chat', 'dm')");
  db.prepare(
    `INSERT INTO tg_messages (id, chat_id, text, timestamp, embedding, embedding_status)
    VALUES ('message', 'chat', 'Retain this message', unixepoch(), ?, 'ready')`
  ).run(vector);
  db.prepare(
    `INSERT INTO knowledge (id, source, text, hash, embedding)
    VALUES ('document', 'memory', 'Retain this document', 'existing-hash', ?)`
  ).run(vector);
  if (database.isVectorSearchReady()) {
    db.prepare("INSERT INTO knowledge_vec (id, embedding) VALUES ('document', ?)").run(vector);
    db.prepare(
      `INSERT INTO tg_messages_vec (id, chat_id, message_id, timestamp, embedding)
      VALUES (?, 'chat', 'message', unixepoch(), ?)`
    ).run(telegramMessageKey("chat", "message"), vector);
  }
}

afterEach(() => {
  closeDatabase();
  for (const database of memories.splice(0)) database.close();
});

describe("embedding identity", () => {
  it("invalidates documents and messages when a model changes at the same dimensions", () => {
    const database = memory();
    synchronizeEmbeddingIdentity(database, provider);
    seedEmbeddings(database);
    synchronizeEmbeddingIdentity(database, { ...provider, model: "second-model" });
    const db = database.getDb();
    expect(db.prepare("SELECT text, embedding, embedding_status FROM tg_messages").get()).toEqual({
      text: "Retain this message",
      embedding: null,
      embedding_status: "pending",
    });
    expect(db.prepare("SELECT text, embedding, hash FROM knowledge").get()).toEqual({
      text: "Retain this document",
      embedding: null,
      hash: "",
    });
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({ n: 0 });
  });

  it("preserves completed indexing across an unchanged provider restart", () => {
    const database = memory();
    synchronizeEmbeddingIdentity(database, provider);
    seedEmbeddings(database);
    synchronizeEmbeddingIdentity(database, provider);
    expect(database.getDb().prepare("SELECT embedding_status FROM tg_messages").get()).toEqual({
      embedding_status: "ready",
    });
    expect(database.getDb().prepare("SELECT hash FROM knowledge").get()).toEqual({
      hash: "existing-hash",
    });
    expect(database.getDb().prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({
      n: 1,
    });
  });

  it("invalidates canonical embeddings when vector search is unavailable", () => {
    const database = memory(false);
    seedEmbeddings(database);
    synchronizeEmbeddingIdentity(database, provider);
    expect(database.getDb().prepare("SELECT embedding, hash FROM knowledge").get()).toEqual({
      embedding: null,
      hash: "",
    });
  });

  it("invalidates embeddings when only the provider changes", () => {
    const database = memory();
    synchronizeEmbeddingIdentity(database, provider);
    seedEmbeddings(database);
    synchronizeEmbeddingIdentity(database, { ...provider, id: "voyage" });
    expect(database.getDb().prepare("SELECT embedding_status FROM tg_messages").get()).toEqual({
      embedding_status: "pending",
    });
    expect(database.getDb().prepare("SELECT hash FROM knowledge").get()).toEqual({ hash: "" });
  });

  it("keeps the previous identity and vectors if invalidation fails", () => {
    const database = memory();
    synchronizeEmbeddingIdentity(database, provider);
    seedEmbeddings(database);
    const db = database.getDb();
    const oldIdentity = db.prepare("SELECT value FROM meta WHERE key = 'embedding_identity'").get();
    db.exec(
      "CREATE TRIGGER reject_reindex BEFORE UPDATE ON knowledge BEGIN SELECT RAISE(ABORT, 'reindex failed'); END"
    );
    expect(() =>
      synchronizeEmbeddingIdentity(database, { ...provider, model: "second-model" })
    ).toThrow("reindex failed");
    expect(db.prepare("SELECT value FROM meta WHERE key = 'embedding_identity'").get()).toEqual(
      oldIdentity
    );
    expect(db.prepare("SELECT embedding_status FROM tg_messages").get()).toEqual({
      embedding_status: "ready",
    });
    expect(db.prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 1 });
  });

  it("creates vector tables from the provider width instead of the supplied stale width", async () => {
    const system = initializeMemory({
      database: { path: ":memory:", enableVectorSearch: true, vectorDimensions: 384 },
      embeddings: { provider: "voyage", model: "voyage-3-lite", apiKey: "test-voyage-key" },
      workspaceDir: "/unused-test-workspace",
    });
    try {
      expect(system.embedder.dimensions).toBe(512);
      for (const name of ["knowledge_vec", "tg_messages_vec"]) {
        expect(system.db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name)).toEqual(
          { sql: expect.stringContaining("FLOAT[512]") }
        );
      }
    } finally {
      await system.dispose();
    }
  });
});

describe("message retention", () => {
  it("prunes canonical rows when vector search is disabled", () => {
    const database = memory(false);
    seedEmbeddings(database);
    database.getDb().exec("UPDATE tg_messages SET timestamp = 0");
    expect(pruneOldMessages(database.getDb())).toBe(1);
  });

  it("removes only expired vectors even when message IDs are reused between chats", () => {
    const database = memory();
    const db = database.getDb();
    const now = Math.floor(Date.now() / 1000);
    for (const [chat, timestamp] of [
      ["old-chat", now - 91 * 86400],
      ["new-chat", now],
    ] as const) {
      db.prepare("INSERT INTO tg_chats (id, type) VALUES (?, 'dm')").run(chat);
      db.prepare(
        "INSERT INTO tg_messages (id, chat_id, text, timestamp) VALUES ('same-id', ?, 'text', ?)"
      ).run(chat, timestamp);
      db.prepare(
        "INSERT INTO tg_messages_vec (id, chat_id, message_id, timestamp, embedding) VALUES (?, ?, 'same-id', ?, ?)"
      ).run(telegramMessageKey(chat, "same-id"), chat, BigInt(timestamp), vector);
    }
    expect(pruneOldMessages(db)).toBe(1);
    expect(db.prepare("SELECT chat_id FROM tg_messages").all()).toEqual([{ chat_id: "new-chat" }]);
    expect(db.prepare("SELECT id FROM tg_messages_vec").all()).toEqual([
      { id: telegramMessageKey("new-chat", "same-id") },
    ]);
  });

  it("rolls back vector deletion if deleting the canonical message fails", () => {
    const database = memory();
    seedEmbeddings(database);
    const db = database.getDb();
    db.exec(`UPDATE tg_messages SET timestamp = 0;
      CREATE TRIGGER reject_retention BEFORE DELETE ON tg_messages BEGIN SELECT RAISE(ABORT, 'retention failed'); END;`);
    expect(() => pruneOldMessages(db)).toThrow("retention failed");
    expect(db.prepare("SELECT count(*) AS n FROM tg_messages").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({ n: 1 });
  });
});

describe("interrupted tasks", () => {
  it("fails interrupted execution and dependent descendants without replaying them", () => {
    const store = new TaskStore(memory(false).getDb());
    const interrupted = store.createTask({ description: "May already have performed an action" });
    const child = store.createTask({ description: "First dependent", dependsOn: [interrupted.id] });
    const grandchild = store.createTask({ description: "Second dependent", dependsOn: [child.id] });
    const independent = store.createTask({ description: "Unrelated pending task" });
    const completed = store.createTask({ description: "Already completed" });
    store.completeTask(completed.id, "existing result");
    store.startTask(interrupted.id);
    expect(store.recoverInterruptedTasks()).toBe(1);
    expect(store.getTask(interrupted.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("outcome unknown"),
      completedAt: expect.any(Date),
    });
    for (const id of [interrupted.id, child.id, grandchild.id]) {
      expect(store.getTask(id)?.status).toBe("failed");
      expect(store.startTask(id)).toBeUndefined();
    }
    expect(store.getTask(independent.id)?.status).toBe("pending");
    expect(store.getTask(completed.id)).toMatchObject({
      status: "done",
      result: "existing result",
    });
    expect(store.getActiveTasks().map((task) => task.id)).toEqual([independent.id]);
    expect(store.recoverInterruptedTasks()).toBe(0);
  });
});
