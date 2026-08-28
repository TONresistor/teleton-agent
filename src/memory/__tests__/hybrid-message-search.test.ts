import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { ensureSchema, ensureVectorTables } from "../schema.js";
import { serializeEmbedding } from "../embeddings/index.js";
import { HybridSearch } from "../search/hybrid.js";

describe("HybridSearch message vector prefilters", () => {
  let db: InstanceType<typeof Database>;
  let search: HybridSearch;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    sqliteVec.load(db);
    ensureVectorTables(db, 2);
    search = new HybridSearch(db, true);
  });

  afterEach(() => db.close());

  function insertMessage(chatId: string, messageId: string, vector: number[]): void {
    db.prepare("INSERT OR IGNORE INTO tg_chats (id, type) VALUES (?, 'group')").run(chatId);
    db.prepare(
      `INSERT INTO tg_messages
         (id, chat_id, text, embedding, embedding_status, timestamp)
       VALUES (?, ?, ?, ?, 'ready', ?)`
    ).run(
      messageId,
      chatId,
      `text-${chatId}-${messageId}`,
      serializeEmbedding(vector),
      2_000_000_000
    );
    db.prepare(
      `INSERT INTO tg_messages_vec (id, chat_id, message_id, timestamp, embedding)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      `${chatId}\u001f${messageId}`,
      chatId,
      messageId,
      2_000_000_000n,
      serializeEmbedding(vector)
    );
  }

  it("filters the current chat before top-K", async () => {
    for (let index = 0; index < 5; index++) insertMessage("other", String(index), [1, 0]);
    insertMessage("current", "target", [0.8, 0.6]);

    const results = await search.searchMessages("no-keyword-match", [1, 0], {
      chatId: "current",
      limit: 1,
    });

    expect(results.map((result) => result.id)).toEqual(["current\u001ftarget"]);
  });

  it("excludes the current chat before global top-K and omits the current message", async () => {
    for (let index = 0; index < 5; index++) insertMessage("current", String(index), [1, 0]);
    insertMessage("other", "global-target", [0.8, 0.6]);

    const global = await search.searchMessages("no-keyword-match", [1, 0], {
      excludeChatId: "current",
      limit: 1,
    });
    expect(global.map((result) => result.id)).toEqual(["other\u001fglobal-target"]);

    const local = await search.searchMessages("no-keyword-match", [1, 0], {
      chatId: "current",
      excludeMessageId: "0",
      limit: 5,
    });
    expect(local.some((result) => result.id === "current\u001f0")).toBe(false);
  });
});
