export * from "./database.js";
export * from "./schema.js";
export * from "./embeddings/index.js";
export * from "./agent/index.js";
export * from "./feed/index.js";
export * from "./search/hybrid.js";
export * from "./search/context.js";

import type Database from "better-sqlite3";
import { getDatabase, type DatabaseConfig } from "./database.js";
import {
  createEmbeddingProvider,
  CachedEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from "./embeddings/index.js";
import { KnowledgeIndexer } from "./agent/knowledge.js";
import { MessageStore } from "./feed/messages.js";
import { ContextBuilder } from "./search/context.js";
import { EmbeddingWorkerProvider } from "./workers/embedding-provider.js";
import { VectorSearchWorkerClient } from "./workers/vector-search-client.js";

export interface MemorySystem {
  db: Database.Database;
  embedder: EmbeddingProvider;
  knowledge: KnowledgeIndexer;
  messages: MessageStore;
  context: ContextBuilder;
  vectorSearch?: VectorSearchWorkerClient;
  dispose(): Promise<void>;
}

export function initializeMemory(config: {
  database: DatabaseConfig;
  embeddings: EmbeddingProviderConfig;
  workspaceDir: string;
}): MemorySystem {
  const db = getDatabase(config.database);
  db.configureVectorSearch(config.database.enableVectorSearch, config.database.vectorDimensions);
  const rawEmbedder =
    config.embeddings.provider === "none"
      ? createEmbeddingProvider(config.embeddings)
      : new EmbeddingWorkerProvider(config.embeddings);
  const vectorEnabled = db.isVectorSearchReady();
  const database: Database.Database = db.getDb();
  const embedder =
    rawEmbedder.id === "noop" ? rawEmbedder : new CachedEmbeddingProvider(rawEmbedder, database);
  const vectorSearchWorker = vectorEnabled
    ? new VectorSearchWorkerClient(database.name)
    : undefined;
  const messages = new MessageStore(database, embedder, vectorEnabled);
  let disposed = false;

  return {
    db: database,
    embedder,
    knowledge: new KnowledgeIndexer(
      database,
      config.workspaceDir,
      embedder,
      vectorEnabled,
      vectorSearchWorker
    ),
    messages,
    context: new ContextBuilder(database, embedder, vectorEnabled, vectorSearchWorker),
    vectorSearch: vectorSearchWorker,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await messages.stopAndDrainPendingEmbeddingBackfill();
      await vectorSearchWorker?.close();
      if (rawEmbedder instanceof EmbeddingWorkerProvider) await rawEmbedder.close();
    },
  };
}
