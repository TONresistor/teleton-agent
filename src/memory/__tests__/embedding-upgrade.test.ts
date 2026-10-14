import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase } from "../database.js";
import { KnowledgeIndexer } from "../agent/knowledge.js";
import { MessageStore, pruneOldMessages, telegramMessageKey } from "../feed/messages.js";
import { synchronizeEmbeddingIdentity } from "../embedding-identity.js";
import { NoopEmbeddingProvider, type EmbeddingProvider } from "../embeddings/provider.js";
import { deserializeEmbedding, serializeEmbedding } from "../embeddings/utils.js";

vi.mock("../embeddings/local.js", () => ({ LocalEmbeddingProvider: class {} }));

let directory: string;
const openDatabases: MemoryDatabase[] = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-vector-upgrade-"));
});
afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  rmSync(directory, { recursive: true, force: true });
});

function openMemory(enabled = true): MemoryDatabase {
  const db = new MemoryDatabase({
    path: join(directory, "memory.db"),
    enableVectorSearch: enabled,
    vectorDimensions: 3,
  });
  openDatabases.push(db);
  return db;
}

function embedder(model = "new-model"): EmbeddingProvider {
  return {
    id: "local",
    model,
    dimensions: 3,
    embedQuery: vi.fn(async () => [0, 1, 0]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0, 1, 0])),
  };
}

describe("persisted embedding upgrades", () => {
  it("survives vector-enabled to none to vector-enabled without loading vec0 in none mode", async () => {
    const oldProvider = embedder("old-model");
    const initial = openMemory();
    synchronizeEmbeddingIdentity(initial, oldProvider);
    const db = initial.getDb();
    const oldVector = serializeEmbedding([1, 0, 0]);
    const now = Math.floor(Date.now() / 1000);
    db.exec("INSERT INTO tg_chats (id, type) VALUES ('chat', 'dm')");
    for (const [id, timestamp] of [
      ["expired", now - 100 * 86400],
      ["retained", now],
    ] as const) {
      db.prepare(
        "INSERT INTO tg_messages (id, chat_id, text, timestamp, embedding, embedding_status) VALUES (?, 'chat', ?, ?, ?, 'ready')"
      ).run(id, `Canonical ${id} message`, timestamp, oldVector);
      db.prepare(
        "INSERT INTO tg_messages_vec (id, chat_id, message_id, timestamp, embedding) SELECT ?, chat_id, id, timestamp, embedding FROM tg_messages WHERE id = ?"
      ).run(telegramMessageKey("chat", id), id);
    }
    db.prepare(
      "INSERT INTO knowledge (id, source, path, text, hash, embedding) VALUES ('archive', 'session', 'archived/session.md', 'Archived canonical text', 'old-hash', ?)"
    ).run(oldVector);
    db.prepare("INSERT INTO knowledge_vec (id, embedding) VALUES ('archive', ?)").run(oldVector);
    initial.close();

    const disabled = openMemory(false);
    expect(disabled.isVectorSearchReady()).toBe(false);
    expect(() => disabled.getDb().prepare("SELECT count(*) FROM knowledge_vec").get()).toThrow(
      /no such module: vec0/
    );
    expect(() => synchronizeEmbeddingIdentity(disabled, new NoopEmbeddingProvider())).not.toThrow();
    expect(pruneOldMessages(disabled.getDb(), 90, false)).toBe(1);
    expect(disabled.getDb().prepare("SELECT id, embedding FROM tg_messages").all()).toEqual([
      { id: "retained", embedding: null },
    ]);
    expect(disabled.getDb().prepare("SELECT text, embedding FROM knowledge").get()).toEqual({
      text: "Archived canonical text",
      embedding: null,
    });
    disabled.close();

    const resumed = openMemory();
    const newProvider = embedder();
    synchronizeEmbeddingIdentity(resumed, newProvider);
    expect(resumed.getDb().prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({
      n: 0,
    });
    expect(resumed.getDb().prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({
      n: 0,
    });
    const indexer = new KnowledgeIndexer(
      resumed.getDb(),
      join(directory, "absent-workspace"),
      newProvider,
      true
    );
    expect(await indexer.reembedPending()).toBe(1);
    const messages = new MessageStore(resumed.getDb(), newProvider, true);
    expect(await messages.backfillPendingEmbeddings()).toEqual({
      indexed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(newProvider.embedBatch).toHaveBeenCalledWith(["Archived canonical text"]);
    for (const table of ["knowledge", "tg_messages"]) {
      const row = resumed.getDb().prepare(`SELECT embedding FROM ${table}`).get() as {
        embedding: Buffer;
      };
      expect(deserializeEmbedding(row.embedding)).toEqual([0, 1, 0]);
    }
    expect(resumed.getDb().prepare("SELECT id FROM tg_messages_vec").all()).toEqual([
      { id: telegramMessageKey("chat", "retained") },
    ]);
    expect(await indexer.indexAll()).toEqual({ indexed: 0, skipped: 0 });
  });

  it("backfills archived canonical rows and rows whose vector alone is missing across batches", async () => {
    const memory = openMemory();
    const db = memory.getDb();
    for (let index = 0; index < 20; index++) {
      const id = String(index).padStart(2, "0");
      db.prepare(
        "INSERT INTO knowledge (id, source, path, text, hash, embedding) VALUES (?, 'session', ?, ?, 'original-hash', ?)"
      ).run(
        id,
        `removed/archive-${id}.md`,
        `Canonical archived ${id}`,
        index % 2 === 0 ? null : serializeEmbedding([1, 0, 0])
      );
    }
    const provider = embedder();
    const indexer = new KnowledgeIndexer(db, join(directory, "missing"), provider, true);
    expect(await indexer.reembedPending()).toBe(20);
    expect(provider.embedBatch).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 20 });
    expect(
      db.prepare("SELECT count(*) AS n FROM knowledge WHERE hash = 'original-hash'").get()
    ).toEqual({ n: 20 });
    expect(await indexer.reembedPending()).toBe(0);
    expect(provider.embedBatch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed batches before changing canonical embeddings or vectors", async () => {
    const memory = openMemory();
    const db = memory.getDb();
    db.exec(
      "INSERT INTO knowledge (id, source, text, hash) VALUES ('a', 'learned', 'first', 'hash-a'), ('b', 'learned', 'second', 'hash-b')"
    );
    const provider = embedder();
    vi.mocked(provider.embedBatch).mockResolvedValue([
      [0, 1, 0],
      [0, 1],
    ]);
    const indexer = new KnowledgeIndexer(db, directory, provider, true);
    await expect(indexer.reembedPending()).rejects.toThrow("expected 3");
    expect(db.prepare("SELECT count(*) AS n FROM knowledge WHERE embedding IS NULL").get()).toEqual(
      { n: 2 }
    );
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 0 });
  });

  it("leaves canonical knowledge intact when embeddings are disabled", async () => {
    const memory = openMemory(false);
    memory
      .getDb()
      .exec(
        "INSERT INTO knowledge (id, source, text, hash) VALUES ('a', 'session', 'Archived text', 'original-hash')"
      );
    const provider = embedder();
    const indexer = new KnowledgeIndexer(memory.getDb(), directory, provider, false);
    expect(await indexer.reembedPending()).toBe(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(memory.getDb().prepare("SELECT text, hash FROM knowledge").get()).toEqual({
      text: "Archived text",
      hash: "original-hash",
    });
  });
});
