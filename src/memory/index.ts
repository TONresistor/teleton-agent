export * from "./database.js";
export * from "./schema.js";
export * from "./embeddings/index.js";
export * from "./agent/index.js";
export * from "./feed/index.js";
export * from "./search/hybrid.js";
export * from "./search/context.js";

import type Database from "better-sqlite3";
import { getDatabase, type DatabaseConfig } from "./database.js";
import { createEmbeddingProvider, type EmbeddingProviderConfig } from "./embeddings/index.js";
import { KnowledgeIndexer } from "./agent/knowledge.js";
import { MessageStore } from "./feed/messages.js";
import { ContextBuilder } from "./search/context.js";

export interface MemorySystem {
  db: Database.Database;
  embedder: ReturnType<typeof createEmbeddingProvider>;
  knowledge: KnowledgeIndexer;
  messages: MessageStore;
  context: ContextBuilder;
}

/**
 * Initialize memory system
 */
export function initializeMemory(config: {
  database: DatabaseConfig;
  embeddings: EmbeddingProviderConfig;
  workspaceDir: string;
}): MemorySystem {
  const db = getDatabase(config.database);
  const embedder = createEmbeddingProvider(config.embeddings);

  const vectorEnabled = db.isVectorSearchReady();
  const database: Database.Database = db.getDb();

  return {
    db: database,
    embedder,
    knowledge: new KnowledgeIndexer(database, config.workspaceDir, embedder, vectorEnabled),
    messages: new MessageStore(database, embedder, vectorEnabled),
    context: new ContextBuilder(database, embedder, vectorEnabled),
  };
}
