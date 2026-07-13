import type Database from "better-sqlite3";
import type { Config } from "./config/schema.js";
import type { EmbeddingProvider } from "./memory/embeddings/provider.js";
import type { KnowledgeIndexer } from "./memory/agent/knowledge.js";
import type { MessageStore } from "./memory/feed/messages.js";
import type { SupportedProvider } from "./config/providers.js";
import { readRawConfig, writeRawConfig } from "./config/configurable-keys.js";
import { getDatabase } from "./memory/index.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("StartupMaintenance");

export class StartupMaintenance {
  constructor(
    private db: Database.Database,
    private config: Config,
    private configPath: string,
    private memory: {
      embedder: EmbeddingProvider;
      knowledge: KnowledgeIndexer;
      messages: MessageStore;
    }
  ) {}

  async run(): Promise<{
    indexResult: { indexed: number };
    ftsResult: { knowledge: number; messages: number };
  }> {
    // Migrate sessions from JSON to SQLite (one-time)
    const { migrateSessionsToDb } = await import("./session/migrate.js");
    migrateSessionsToDb();

    // Cleanup old transcript files (>30 days)
    const { cleanupOldTranscripts } = await import("./session/transcript.js");
    cleanupOldTranscripts(30);

    // Prune old sessions (>30 days)
    const { pruneOldSessions } = await import("./session/store.js");
    pruneOldSessions(30);

    // Prune old tg_messages (>90 days)
    const { pruneOldMessages } = await import("./memory/feed/messages.js");
    const prunedMessages = pruneOldMessages(this.db, 90);
    if (prunedMessages > 0) {
      log.info(`Pruned ${prunedMessages} old tg_messages`);
    }

    // Cleanup old daily log files (>60 days)
    const { cleanupOldDailyLogs } = await import("./memory/daily-logs.js");
    cleanupOldDailyLogs(60);

    // Harden permissions on existing files (one-shot, idempotent)
    const { hardenExistingPermissions } = await import("./workspace/harden-permissions.js");
    hardenExistingPermissions();

    // Ensure heartbeat config exists in YAML
    {
      const raw = readRawConfig(this.configPath);
      if (raw && !raw.heartbeat) {
        raw.heartbeat = {
          enabled: this.config.heartbeat.enabled,
          interval_ms: this.config.heartbeat.interval_ms,
          self_configurable: this.config.heartbeat.self_configurable,
        };
        writeRawConfig(raw, this.configPath);
        log.info("Config: heartbeat section added to config.yaml");
      }
    }

    // Warmup embedding model (pre-download at startup, not on first message)
    if (this.memory.embedder.warmup) {
      await this.memory.embedder.warmup();
    }

    const messageBackfill = await this.memory.messages.backfillPendingEmbeddings();
    if (messageBackfill.indexed > 0 || messageBackfill.failed > 0) {
      log.info(
        `Message embedding backfill: ${messageBackfill.indexed} indexed, ${messageBackfill.failed} failed`
      );
    }

    // Index knowledge base (MEMORY.md, memory/*.md)
    const db = getDatabase();
    const forceReindex = db.didDimensionsChange();
    const indexResult = await this.memory.knowledge.indexAll({ force: forceReindex });
    let ftsResult = { knowledge: 0, messages: 0 };
    if (indexResult.indexed > 0) {
      ftsResult = db.rebuildFtsIndexes();
    }

    // Prune orphan knowledge chunks (files deleted from disk)
    const orphanResult = await this.memory.knowledge.pruneOrphans();
    if (orphanResult.markedInactive > 0 || orphanResult.deleted > 0) {
      log.info(
        `Knowledge pruning: ${orphanResult.markedInactive} chunks marked inactive, ${orphanResult.deleted} stale chunks deleted`
      );
    }

    // Consolidate old session memory files (non-blocking)
    import("./session/memory-hook.js")
      .then(({ consolidateOldMemoryFiles }) =>
        consolidateOldMemoryFiles({
          apiKey: this.config.agent.api_key,
          provider: this.config.agent.provider as SupportedProvider,
          utilityModel: this.config.agent.utility_model,
        })
      )
      .then((r) => {
        if (r.consolidated > 0) log.info(`Consolidated ${r.consolidated} old session memory files`);
      })
      .catch((error) => log.warn({ err: error }, "Memory consolidation skipped"));

    return { indexResult, ftsResult };
  }
}
