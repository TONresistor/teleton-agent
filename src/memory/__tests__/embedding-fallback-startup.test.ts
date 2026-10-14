import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../../config/schema.js";
import { StartupMaintenance } from "../../startup-maintenance.js";
import { KnowledgeIndexer } from "../agent/knowledge.js";
import { MemoryDatabase } from "../database.js";
import { CachedEmbeddingProvider } from "../embeddings/cached.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { deserializeEmbedding } from "../embeddings/utils.js";
import { MessageStore } from "../feed/messages.js";
import { getDatabase } from "../index.js";

vi.mock("../embeddings/local.js", () => ({ LocalEmbeddingProvider: class {} }));
vi.mock("../index.js", () => ({ getDatabase: vi.fn() }));
vi.mock("../../session/migrate.js", () => ({ migrateSessionsToDb: vi.fn() }));
vi.mock("../../workspace/harden-permissions.js", () => ({ hardenExistingPermissions: vi.fn() }));
vi.mock("../../session/memory-hook.js", () => ({
  consolidateOldMemoryFiles: vi.fn(async () => ({ consolidated: 0 })),
}));
vi.mock("../../config/configurable-keys.js", () => ({
  readRawConfig: vi.fn(() => undefined),
  writeRawConfig: vi.fn(),
}));

let directory: string;
let memory: MemoryDatabase;
const stores: MessageStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-fallback-startup-"));
  memory = new MemoryDatabase({
    path: join(directory, "memory.db"),
    enableVectorSearch: true,
    vectorDimensions: 3,
  });
  vi.mocked(getDatabase).mockReturnValue(memory);
  // Retention uses the real user's transcript/session paths; it is outside this test.
  vi.spyOn(StartupMaintenance.prototype, "runRetention").mockResolvedValue();
});

afterEach(async () => {
  for (const store of stores.splice(0)) await store.stopAndDrainPendingEmbeddingBackfill();
  memory.close();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function components(ready: boolean, workspaceDir = join(directory, "missing-workspace")) {
  const raw = {
    id: "local",
    model: "test-model",
    dimensions: 3,
    warmup: vi.fn(async () => ready),
    embedQuery: vi.fn(async () => (ready ? [0, 1, 0] : [])),
    embedBatch: vi.fn(async (texts: string[]) => (ready ? texts.map(() => [0, 1, 0]) : [])),
  } satisfies EmbeddingProvider;
  const embedder = new CachedEmbeddingProvider(raw, memory.getDb());
  const knowledge = new KnowledgeIndexer(memory.getDb(), workspaceDir, embedder, true);
  const messages = new MessageStore(memory.getDb(), embedder, true);
  stores.push(messages);
  const config = ConfigSchema.parse({
    agent: { api_key: "test-key" },
    telegram: { api_id: 12345, api_hash: "test-hash", phone: "+1234567890" },
  });
  const maintenance = new StartupMaintenance(
    memory.getDb(),
    config,
    join(directory, "config.yaml"),
    {
      embedder,
      knowledge,
      messages,
    }
  );
  return { raw, embedder, knowledge, messages, maintenance };
}

describe("startup after local embedding warmup failure", () => {
  it("indexes real workspace text through FTS offline and restores its vectors in the same indexer", async () => {
    const text = "# Lighthouse\n\nThe lighthouse coordinates are kept in memory.\n";
    writeFileSync(join(directory, "MEMORY.md"), text);
    const { raw, embedder, knowledge, maintenance } = components(true, directory);
    raw.warmup.mockResolvedValueOnce(false);

    await expect(maintenance.run()).resolves.toMatchObject({
      indexResult: { indexed: 1 },
      ftsResult: { knowledge: 1 },
    });
    expect(raw.embedBatch).not.toHaveBeenCalled();
    const db = memory.getDb();
    expect(db.prepare("SELECT path, text, embedding FROM knowledge").get()).toEqual({
      path: "MEMORY.md",
      text: text.trim(),
      embedding: null,
    });
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 0 });
    expect(await knowledge.search("lighthouse", [], 5)).toEqual([
      expect.objectContaining({ text: text.trim() }),
    ]);

    await expect(embedder.warmup()).resolves.toBe(true);
    knowledge.setEmbeddingAvailability(true);
    await expect(knowledge.reembedPending()).resolves.toBe(1);
    expect(raw.embedBatch).toHaveBeenCalledWith([text.trim()]);
    const restored = db.prepare("SELECT text, embedding FROM knowledge").get() as {
      text: string;
      embedding: Buffer;
    };
    expect(restored.text).toBe(text.trim());
    expect(deserializeEmbedding(restored.embedding)).toEqual([0, 1, 0]);
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 1 });
    expect(await knowledge.search("lighthouse", [], 5)).toEqual([
      expect.objectContaining({ text: text.trim() }),
    ]);
  });

  it("does not serve cached vectors while warmup is unavailable and restores them after recovery", async () => {
    const { raw, embedder } = components(true);
    await expect(embedder.embedQuery("cached query")).resolves.toEqual([0, 1, 0]);
    await expect(embedder.embedBatch(["cached document"])).resolves.toEqual([[0, 1, 0]]);
    expect(memory.getDb().prepare("SELECT count(*) AS n FROM embedding_cache").get()).toEqual({
      n: 2,
    });
    raw.embedQuery.mockClear();
    raw.embedBatch.mockClear();
    raw.warmup.mockResolvedValueOnce(false);

    await expect(embedder.warmup()).resolves.toBe(false);
    await expect(embedder.embedQuery("cached query")).resolves.toEqual([]);
    await expect(embedder.embedBatch(["cached document", "uncached document"])).resolves.toEqual(
      []
    );
    expect(raw.embedQuery).not.toHaveBeenCalled();
    expect(raw.embedBatch).not.toHaveBeenCalled();

    await expect(embedder.warmup()).resolves.toBe(true);
    await expect(embedder.embedQuery("cached query")).resolves.toEqual([0, 1, 0]);
    await expect(embedder.embedBatch(["cached document"])).resolves.toEqual([[0, 1, 0]]);
    expect(raw.embedQuery).not.toHaveBeenCalled();
    expect(raw.embedBatch).not.toHaveBeenCalled();
  });

  it("turns a warmup exception into unavailable FTS mode without invoking the inner embedder", async () => {
    const { raw, embedder } = components(true);
    raw.warmup.mockRejectedValueOnce(new Error("local model unavailable"));

    await expect(embedder.warmup()).resolves.toBe(false);
    await expect(embedder.embedQuery("query")).resolves.toEqual([]);
    await expect(embedder.embedBatch(["document"])).resolves.toEqual([]);
    expect(raw.embedQuery).not.toHaveBeenCalled();
    expect(raw.embedBatch).not.toHaveBeenCalled();
  });

  it("starts in FTS mode with pending archives and reembeds them on a healthy restart", async () => {
    const db = memory.getDb();
    db.exec(`
      INSERT INTO knowledge (id, source, path, text, hash)
      VALUES ('archive', 'session', 'deleted/session.md', 'Archived lighthouse observations', 'original-hash');
      INSERT INTO tg_chats (id, type) VALUES ('chat', 'dm');
      INSERT INTO tg_messages (id, chat_id, text, timestamp, embedding_status)
      VALUES ('message', 'chat', 'Retained lighthouse conversation', unixepoch(), 'pending');
    `);

    const unavailable = components(false);
    await expect(unavailable.maintenance.run()).resolves.toMatchObject({
      indexResult: { indexed: 0 },
    });
    expect(unavailable.raw.warmup).toHaveBeenCalledOnce();
    expect(unavailable.raw.embedBatch).not.toHaveBeenCalled();
    await unavailable.messages.startPendingEmbeddingBackfill();
    await unavailable.messages.stopAndDrainPendingEmbeddingBackfill();
    expect(db.prepare("SELECT text, hash, embedding FROM knowledge").get()).toEqual({
      text: "Archived lighthouse observations",
      hash: "original-hash",
      embedding: null,
    });
    expect(db.prepare("SELECT embedding, embedding_status FROM tg_messages").get()).toEqual({
      embedding: null,
      embedding_status: "pending",
    });
    expect(await unavailable.knowledge.search("lighthouse", [], 5)).toEqual([
      expect.objectContaining({ id: "archive", text: "Archived lighthouse observations" }),
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM embedding_cache").get()).toEqual({ n: 0 });

    const healthy = components(true);
    await expect(healthy.maintenance.run()).resolves.toMatchObject({ indexResult: { indexed: 0 } });
    expect(healthy.raw.warmup).toHaveBeenCalledOnce();
    expect(healthy.raw.embedBatch).toHaveBeenCalledWith(["Archived lighthouse observations"]);
    expect(healthy.raw.embedBatch).toHaveBeenCalledWith(["Retained lighthouse conversation"]);
    const archive = db.prepare("SELECT embedding FROM knowledge WHERE id = 'archive'").get() as {
      embedding: Buffer;
    };
    expect(deserializeEmbedding(archive.embedding)).toEqual([0, 1, 0]);
    expect(db.prepare("SELECT count(*) AS n FROM knowledge_vec").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT embedding_status FROM tg_messages").get()).toEqual({
      embedding_status: "ready",
    });
  });
});
