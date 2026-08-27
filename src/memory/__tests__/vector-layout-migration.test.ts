import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryDatabase } from "../database.js";
import { ensureSchema, setSchemaVersion } from "../schema.js";
import { serializeEmbedding } from "../embeddings/index.js";

describe("Telegram vector layout migration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("discards legacy query-purpose vectors and schedules document re-embedding", () => {
    const directory = mkdtempSync(join(tmpdir(), "teleton-vector-layout-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "memory.db");
    const seed = new Database(databasePath);
    ensureSchema(seed);
    // 1.24.0 was deployed from the pre-commit WIP and copied legacy query
    // embeddings into the new chat-partitioned table.
    setSchemaVersion(seed, "1.24.0");
    sqliteVec.load(seed);
    seed.exec(`
      CREATE VIRTUAL TABLE knowledge_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[3] distance_metric=cosine
      );
      CREATE VIRTUAL TABLE tg_messages_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[3] distance_metric=cosine
      );
      INSERT INTO tg_chats (id, type) VALUES ('chat-a', 'group');
    `);
    const embedding = serializeEmbedding([0.1, 0.2, 0.3]);
    seed
      .prepare(
        `INSERT INTO tg_messages
         (id, chat_id, text, embedding, embedding_status, timestamp)
       VALUES ('message-a', 'chat-a', 'keep vector', ?, 'ready', 123)`
      )
      .run(embedding);
    seed
      .prepare("INSERT INTO tg_messages_vec (id, embedding) VALUES (?, ?)")
      .run("chat-a\u001fmessage-a", embedding);
    seed.close();

    const memory = new MemoryDatabase({
      path: databasePath,
      enableVectorSearch: true,
      vectorDimensions: 3,
    });
    const vectorCount = memory
      .getDb()
      .prepare("SELECT COUNT(*) AS count FROM tg_messages_vec")
      .get();
    const message = memory
      .getDb()
      .prepare("SELECT embedding, embedding_status FROM tg_messages WHERE id = 'message-a'")
      .get();

    expect(vectorCount).toEqual({ count: 0 });
    expect(message).toEqual({ embedding: null, embedding_status: "pending" });
    expect(memory.didDimensionsChange()).toBe(false);
    memory.close();
  });
});
