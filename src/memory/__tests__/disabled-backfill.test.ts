import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDatabase } from "../database.js";
import { synchronizeEmbeddingIdentity } from "../embedding-identity.js";
import { NoopEmbeddingProvider, type EmbeddingProvider } from "../embeddings/provider.js";
import { serializeEmbedding } from "../embeddings/utils.js";
import { MessageStore } from "../feed/messages.js";

vi.mock("../embeddings/local.js", () => ({ LocalEmbeddingProvider: class {} }));
vi.mock("sqlite-vec", async (importOriginal) => {
  const original = await importOriginal<typeof import("sqlite-vec")>();
  return { ...original, load: vi.fn(original.load) };
});

let directory: string;
const memories: MemoryDatabase[] = [];
const stores: MessageStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-disabled-backfill-"));
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const store of stores.splice(0)) await store.stopAndDrainPendingEmbeddingBackfill();
  for (const memory of memories.splice(0)) memory.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function openMemory(enabled: boolean): MemoryDatabase {
  const memory = new MemoryDatabase({
    path: join(directory, "memory.db"),
    enableVectorSearch: enabled,
    vectorDimensions: 3,
  });
  memories.push(memory);
  return memory;
}

function provider(): EmbeddingProvider {
  return {
    id: "local",
    model: "test-model",
    dimensions: 3,
    embedQuery: vi.fn(async () => [0, 1, 0]),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [0, 1, 0])),
  };
}

function seedReadyMessage(memory: MemoryDatabase): void {
  memory.getDb().exec("INSERT INTO tg_chats (id, type) VALUES ('chat', 'dm')");
  memory
    .getDb()
    .prepare(
      "INSERT INTO tg_messages (id, chat_id, text, timestamp, embedding, embedding_status) VALUES ('old', 'chat', 'Retained canonical message', unixepoch(), ?, 'ready')"
    )
    .run(serializeEmbedding([1, 0, 0]));
}

async function expectDormantQueue(store: MessageStore): Promise<void> {
  const original = store.startPendingEmbeddingBackfill.bind(store);
  let starts = 0;
  // Bound the old recursive implementation so this regression test cannot hang.
  const start = vi.spyOn(store, "startPendingEmbeddingBackfill").mockImplementation((...args) => {
    starts++;
    return starts < 5 ? original(...args) : Promise.resolve();
  });
  const batch = vi.spyOn(store, "backfillPendingEmbeddings");
  const heartbeat = vi.fn();
  setTimeout(heartbeat, 1);
  await store.startPendingEmbeddingBackfill();
  await vi.advanceTimersByTimeAsync(1);
  expect(heartbeat).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  expect(batch).not.toHaveBeenCalled();
}

describe("disabled Telegram embedding queues", () => {
  it("repairs pending rows from an earlier none startup even when the saved identity already matches", async () => {
    const initial = openMemory(true);
    seedReadyMessage(initial);
    initial.close();

    const memory = openMemory(false);
    const noop = new NoopEmbeddingProvider();
    synchronizeEmbeddingIdentity(memory, noop);
    memory.getDb().exec("UPDATE tg_messages SET embedding_status = 'pending' WHERE id = 'old'");
    expect(
      memory.getDb().prepare("SELECT value FROM meta WHERE key = 'embedding_identity'").get()
    ).toEqual({ value: JSON.stringify([noop.id, noop.model, noop.dimensions]) });
    expect(() => memory.getDb().prepare("SELECT count(*) FROM tg_messages_vec").get()).toThrow(
      /no such module: vec0/
    );

    expect(() => synchronizeEmbeddingIdentity(memory, noop)).not.toThrow();
    const store = new MessageStore(memory.getDb(), noop, false);
    stores.push(store);
    await expectDormantQueue(store);
    expect(
      memory.getDb().prepare("SELECT text, embedding, embedding_status FROM tg_messages").get()
    ).toEqual({
      text: "Retained canonical message",
      embedding: null,
      embedding_status: "disabled",
    });
  });

  it("never embeds with a noop provider even if vector tables are available", async () => {
    const memory = openMemory(true);
    seedReadyMessage(memory);
    const noop = new NoopEmbeddingProvider();
    synchronizeEmbeddingIdentity(memory, noop);
    const embed = vi.spyOn(noop, "embedBatch");
    const store = new MessageStore(memory.getDb(), noop, true);
    stores.push(store);

    await expectDormantQueue(store);
    expect(embed).not.toHaveBeenCalled();
    expect(memory.getDb().prepare("SELECT embedding FROM tg_messages").get()).toEqual({
      embedding: null,
    });
  });

  it("does not relaunch after vector identity invalidation when the provider is none", async () => {
    const initial = openMemory(true);
    synchronizeEmbeddingIdentity(initial, provider());
    seedReadyMessage(initial);
    initial.close();

    const memory = openMemory(false);
    const noop = new NoopEmbeddingProvider();
    synchronizeEmbeddingIdentity(memory, noop);
    const store = new MessageStore(memory.getDb(), noop, false);
    stores.push(store);

    await expectDormantQueue(store);
    expect(memory.getDb().prepare("SELECT text, embedding FROM tg_messages").get()).toEqual({
      text: "Retained canonical message",
      embedding: null,
    });
  });

  it("keeps pending messages without spinning when sqlite-vec cannot load", async () => {
    vi.mocked(sqliteVec.load).mockImplementationOnce(() => {
      throw new Error("sqlite-vec unavailable for this runtime");
    });
    const memory = openMemory(true);
    expect(memory.isVectorSearchReady()).toBe(false);
    seedReadyMessage(memory);
    const embedder = provider();
    synchronizeEmbeddingIdentity(memory, embedder);
    const store = new MessageStore(memory.getDb(), embedder, memory.isVectorSearchReady());
    stores.push(store);

    await expectDormantQueue(store);
    expect(embedder.embedBatch).not.toHaveBeenCalled();
    expect(
      memory.getDb().prepare("SELECT embedding, embedding_status FROM tg_messages").get()
    ).toEqual({
      embedding: null,
      embedding_status: "pending",
    });
  });

  it("indexes retained and new text when vectors are enabled after none", async () => {
    const disabled = openMemory(false);
    const noop = new NoopEmbeddingProvider();
    seedReadyMessage(disabled);
    synchronizeEmbeddingIdentity(disabled, noop);
    const disabledStore = new MessageStore(disabled.getDb(), noop, false);
    stores.push(disabledStore);
    await disabledStore.storeMessage({
      id: "new",
      chatId: "chat",
      senderId: null,
      text: "Written while embeddings are disabled",
      isFromAgent: false,
      hasMedia: false,
      timestamp: Math.floor(Date.now() / 1000),
    });
    await disabledStore.stopAndDrainPendingEmbeddingBackfill();
    disabled.close();

    const resumed = openMemory(true);
    const embedder = provider();
    synchronizeEmbeddingIdentity(resumed, embedder);
    const store = new MessageStore(resumed.getDb(), embedder, true);
    stores.push(store);
    await store.startPendingEmbeddingBackfill();
    await store.stopAndDrainPendingEmbeddingBackfill();

    expect(resumed.getDb().prepare("SELECT count(*) AS n FROM tg_messages_vec").get()).toEqual({
      n: 2,
    });
    expect(
      resumed.getDb().prepare("SELECT DISTINCT embedding_status FROM tg_messages").all()
    ).toEqual([{ embedding_status: "ready" }]);
    expect(embedder.embedBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        "Retained canonical message",
        "Written while embeddings are disabled",
      ])
    );
  });
});
