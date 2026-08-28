import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import * as sqliteVec from "sqlite-vec";
import { SQLITE_CACHE_SIZE_KB, SQLITE_MMAP_SIZE } from "../../constants/limits.js";
import { serializeEmbedding } from "../embeddings/index.js";
import { HybridSearch } from "../search/hybrid.js";
import type {
  RpcRequest,
  RpcResponse,
  VectorContextSearchPayload,
  VectorSearchPayload,
  VectorSearchResult,
  VectorToolSearchResult,
  VectorSearchWorkerData,
} from "./protocol.js";

if (!parentPort) throw new Error("Vector search worker requires a parent port");
const port = parentPort;

const { databasePath } = workerData as VectorSearchWorkerData;
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
sqliteVec.load(db);
db.pragma("query_only = ON");
db.pragma(`cache_size = -${SQLITE_CACHE_SIZE_KB}`);
db.pragma("temp_store = MEMORY");
db.pragma(`mmap_size = ${SQLITE_MMAP_SIZE}`);
db.pragma("busy_timeout = 5000");

const search = new HybridSearch(db, true, false);
let queue = Promise.resolve();

async function runContextSearch(payload: VectorContextSearchPayload): Promise<VectorSearchResult> {
  const totalStartedAt = performance.now();

  const knowledgeStartedAt = performance.now();
  const knowledge = payload.includeKnowledge
    ? await search.searchKnowledge(payload.query, payload.queryEmbedding, {
        limit: payload.knowledgeLimit,
      })
    : [];
  const knowledgeMs = performance.now() - knowledgeStartedAt;

  const currentChatStartedAt = performance.now();
  const currentChat = payload.includeFeedHistory
    ? await search.searchMessages(payload.query, payload.queryEmbedding, {
        chatId: payload.chatId,
        excludeMessageId: payload.currentMessageId,
        limit: payload.messageLimit,
        afterTimestamp: payload.afterTimestamp,
      })
    : [];
  const currentChatMs = performance.now() - currentChatStartedAt;

  const otherChatsStartedAt = performance.now();
  const otherChats =
    payload.includeFeedHistory && payload.searchAllChats
      ? await search.searchMessages(payload.query, payload.queryEmbedding, {
          excludeChatId: payload.chatId,
          limit: payload.messageLimit,
          afterTimestamp: payload.afterTimestamp,
        })
      : [];
  const otherChatsMs = performance.now() - otherChatsStartedAt;

  return {
    knowledge,
    currentChat,
    otherChats,
    timingsMs: {
      knowledge: knowledgeMs,
      currentChat: currentChatMs,
      otherChats: otherChatsMs,
      total: performance.now() - totalStartedAt,
    },
  };
}

async function handle(payload: VectorSearchPayload): Promise<unknown> {
  switch (payload.type) {
    case "search":
      return runContextSearch(payload);
    case "searchKnowledge":
      return search.searchKnowledge(payload.query, payload.queryEmbedding, {
        limit: payload.limit,
      });
    case "searchTools": {
      if (payload.queryEmbedding.length === 0) return [];
      const rows = db
        .prepare(
          `SELECT tv.name, ti.description, tv.distance
           FROM (
             SELECT name, distance
             FROM tool_index_vec
             WHERE embedding MATCH ? AND k = ?
           ) tv
           JOIN tool_index ti ON ti.name = tv.name`
        )
        .all(serializeEmbedding(payload.queryEmbedding), payload.limit) as VectorToolSearchResult[];
      return rows;
    }
  }
}

port.on("message", (request: RpcRequest) => {
  queue = queue.then(async () => {
    try {
      const payload = request.payload as VectorSearchPayload;
      const result = await handle(payload);
      port.postMessage({ id: request.id, ok: true, result } satisfies RpcResponse);
    } catch (error) {
      port.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RpcResponse);
    }
  });
});
