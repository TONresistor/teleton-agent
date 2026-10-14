import type { MemoryDatabase } from "./database.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";

export function synchronizeEmbeddingIdentity(
  memory: MemoryDatabase,
  provider: EmbeddingProvider
): void {
  const db = memory.getDb();
  const identity = JSON.stringify([provider.id, provider.model, provider.dimensions]);
  const previous = db.prepare("SELECT value FROM meta WHERE key = 'embedding_identity'").get() as
    { value: string } | undefined;
  const pendingReset = db
    .prepare("SELECT value FROM meta WHERE key = 'embedding_vectors_pending_reset'")
    .get() as { value: string } | undefined;
  if (
    previous?.value === identity &&
    !(pendingReset?.value === "1" && memory.isVectorSearchReady())
  ) {
    if (provider.id === "noop") {
      db.prepare(
        `UPDATE tg_messages SET embedding = NULL, embedding_status = 'disabled',
        indexed_at = unixepoch() WHERE text IS NOT NULL
        AND (embedding_status != 'disabled' OR embedding IS NOT NULL)`
      ).run();
    }
    return;
  }
  db.transaction(() => {
    memory.invalidateTelegramMessageEmbeddings(
      memory.isVectorSearchReady(),
      provider.id === "noop" ? "disabled" : "pending"
    );
    const hasKnowledgeVectors = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'knowledge_vec'")
      .get();
    if (hasKnowledgeVectors && memory.isVectorSearchReady()) db.exec("DELETE FROM knowledge_vec");
    const hasVectorTables = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name IN ('knowledge_vec', 'tg_messages_vec')")
      .get();
    if (hasVectorTables && !memory.isVectorSearchReady()) {
      db.prepare(
        `INSERT INTO meta (key, value, updated_at) VALUES ('embedding_vectors_pending_reset', '1', unixepoch())
        ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = unixepoch()`
      ).run();
    } else {
      db.prepare("DELETE FROM meta WHERE key = 'embedding_vectors_pending_reset'").run();
    }
    db.prepare("UPDATE knowledge SET hash = '', embedding = NULL").run();
    db.prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES ('embedding_identity', ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(identity);
  })();
}
