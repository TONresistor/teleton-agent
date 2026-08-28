import type { EmbeddingProviderConfig } from "../embeddings/provider.js";
import type { HybridSearchResult } from "../search/hybrid.js";

export interface RpcRequest {
  id: number;
  type: string;
  payload?: unknown;
}

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export interface EmbeddingWorkerData {
  config: EmbeddingProviderConfig;
}

export type EmbeddingWorkerPayload =
  | { type: "warmup" }
  | { type: "embedQuery"; text: string }
  | { type: "embedBatch"; texts: string[] };

export interface VectorSearchWorkerData {
  databasePath: string;
}

export interface VectorContextSearchPayload {
  type: "search";
  query: string;
  queryEmbedding: number[];
  chatId: string;
  currentMessageId?: string;
  afterTimestamp?: number;
  includeKnowledge: boolean;
  includeFeedHistory: boolean;
  knowledgeLimit: number;
  messageLimit: number;
  searchAllChats: boolean;
}

export interface VectorKnowledgeSearchPayload {
  type: "searchKnowledge";
  query: string;
  queryEmbedding: number[];
  limit: number;
}

export interface VectorToolSearchPayload {
  type: "searchTools";
  queryEmbedding: number[];
  limit: number;
}

export type VectorSearchPayload =
  | VectorContextSearchPayload
  | VectorKnowledgeSearchPayload
  | VectorToolSearchPayload;

export interface VectorSearchResult {
  knowledge: HybridSearchResult[];
  currentChat: HybridSearchResult[];
  otherChats: HybridSearchResult[];
  timingsMs: {
    knowledge: number;
    currentChat: number;
    otherChats: number;
    total: number;
  };
}

export interface VectorToolSearchResult {
  name: string;
  description: string;
  distance: number;
}
