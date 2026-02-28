import type Database from "better-sqlite3";
import { JOURNAL_SCHEMA } from "../utils/module-db.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Memory");

function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const parts = v.split("-")[0].split(".").map(Number);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
    };
  };

  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

function versionLessThan(a: string, b: string): boolean {
  return compareSemver(a, b) < 0;
}

export function ensureSchema(db: Database.Database): void {
  db.exec(`
    -- ============================================
    -- METADATA
    -- ============================================
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- ============================================
    -- AGENT MEMORY (Knowledge Base)
    -- ============================================

    -- Knowledge chunks from MEMORY.md, memory/*.md, learned facts
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('memory', 'session', 'learned')),
      path TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge(source);
    CREATE INDEX IF NOT EXISTS idx_knowledge_hash ON knowledge(hash);
    CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at DESC);

    -- Full-text search for knowledge
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      text,
      id UNINDEXED,
      path UNINDEXED,
      source UNINDEXED,
      content='knowledge',
      content_rowid='rowid'
    );

    -- FTS triggers
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, text, id, path, source)
      VALUES (new.rowid, new.text, new.id, new.path, new.source);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge BEGIN
      DELETE FROM knowledge_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE ON knowledge BEGIN
      DELETE FROM knowledge_fts WHERE rowid = old.rowid;
      INSERT INTO knowledge_fts(rowid, text, id, path, source)
      VALUES (new.rowid, new.text, new.id, new.path, new.source);
    END;

    -- Sessions/Conversations
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,               -- session_id (UUID)
      chat_id TEXT UNIQUE NOT NULL,      -- telegram:chat_id
      started_at INTEGER NOT NULL,       -- createdAt (Unix timestamp ms)
      updated_at INTEGER NOT NULL,       -- updatedAt (Unix timestamp ms)
      ended_at INTEGER,                  -- Optional end time
      summary TEXT,                      -- Session summary
      message_count INTEGER DEFAULT 0,   -- Number of messages
      tokens_used INTEGER DEFAULT 0,     -- Deprecated (use context_tokens)
      last_message_id INTEGER,           -- Last Telegram message ID
      last_channel TEXT,                 -- Last channel (telegram/discord/etc)
      last_to TEXT,                      -- Last recipient
      context_tokens INTEGER,            -- Current context size
      model TEXT,                        -- Model used (claude-opus-4-5-20251101)
      provider TEXT,                     -- Provider (anthropic)
      last_reset_date TEXT,              -- YYYY-MM-DD of last daily reset
      input_tokens INTEGER DEFAULT 0,    -- Accumulated input tokens
      output_tokens INTEGER DEFAULT 0    -- Accumulated output tokens
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    -- Tasks
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done', 'failed', 'cancelled')),
      priority INTEGER DEFAULT 0,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      result TEXT,
      error TEXT,
      scheduled_for INTEGER,
      payload TEXT,
      reason TEXT,
      scheduled_message_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_for) WHERE scheduled_for IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by) WHERE created_by IS NOT NULL;

    -- Task Dependencies (for chained tasks)
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_deps_parent ON task_dependencies(depends_on_task_id);

    -- ============================================
    -- TELEGRAM FEED
    -- ============================================

    -- Chats (groups, channels, DMs)
    CREATE TABLE IF NOT EXISTS tg_chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('dm', 'group', 'channel')),
      title TEXT,
      username TEXT,
      member_count INTEGER,
      is_monitored INTEGER DEFAULT 1,
      is_archived INTEGER DEFAULT 0,
      last_message_id TEXT,
      last_message_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_tg_chats_type ON tg_chats(type);
    CREATE INDEX IF NOT EXISTS idx_tg_chats_monitored ON tg_chats(is_monitored, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tg_chats_username ON tg_chats(username) WHERE username IS NOT NULL;

    -- Users
    CREATE TABLE IF NOT EXISTS tg_users (
      id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_bot INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_allowed INTEGER DEFAULT 0,
      first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      message_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tg_users_username ON tg_users(username) WHERE username IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tg_users_admin ON tg_users(is_admin) WHERE is_admin = 1;
    CREATE INDEX IF NOT EXISTS idx_tg_users_last_seen ON tg_users(last_seen_at DESC);

    -- Messages
    CREATE TABLE IF NOT EXISTS tg_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT,
      text TEXT,
      embedding TEXT,
      reply_to_id TEXT,
      forward_from_id TEXT,
      is_from_agent INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      has_media INTEGER DEFAULT 0,
      media_type TEXT,
      timestamp INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (chat_id) REFERENCES tg_chats(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES tg_users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tg_messages_chat ON tg_messages(chat_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tg_messages_sender ON tg_messages(sender_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tg_messages_timestamp ON tg_messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tg_messages_reply ON tg_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tg_messages_from_agent ON tg_messages(is_from_agent, timestamp DESC) WHERE is_from_agent = 1;

    -- Full-text search for messages
    CREATE VIRTUAL TABLE IF NOT EXISTS tg_messages_fts USING fts5(
      text,
      id UNINDEXED,
      chat_id UNINDEXED,
      sender_id UNINDEXED,
      timestamp UNINDEXED,
      content='tg_messages',
      content_rowid='rowid'
    );

    -- FTS triggers for messages
    CREATE TRIGGER IF NOT EXISTS tg_messages_fts_insert AFTER INSERT ON tg_messages BEGIN
      INSERT INTO tg_messages_fts(rowid, text, id, chat_id, sender_id, timestamp)
      VALUES (new.rowid, new.text, new.id, new.chat_id, new.sender_id, new.timestamp);
    END;

    CREATE TRIGGER IF NOT EXISTS tg_messages_fts_delete AFTER DELETE ON tg_messages BEGIN
      DELETE FROM tg_messages_fts WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS tg_messages_fts_update AFTER UPDATE ON tg_messages BEGIN
      DELETE FROM tg_messages_fts WHERE rowid = old.rowid;
      INSERT INTO tg_messages_fts(rowid, text, id, chat_id, sender_id, timestamp)
      VALUES (new.rowid, new.text, new.id, new.chat_id, new.sender_id, new.timestamp);
    END;

    -- ============================================
    -- EMBEDDING CACHE
    -- ============================================

    CREATE TABLE IF NOT EXISTS embedding_cache (
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      embedding BLOB NOT NULL,
      dims INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (hash, model, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed ON embedding_cache(accessed_at);

    -- =====================================================
    -- EXEC AUDIT (Command Execution History)
    -- =====================================================

    CREATE TABLE IF NOT EXISTS exec_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      user_id INTEGER NOT NULL,
      username TEXT,
      tool TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'success', 'failed', 'timeout', 'killed')),
      exit_code INTEGER,
      signal TEXT,
      duration_ms INTEGER,
      stdout TEXT,
      stderr TEXT,
      truncated INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_exec_audit_timestamp ON exec_audit(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_exec_audit_user ON exec_audit(user_id);

    -- =====================================================
    -- JOURNAL (Trading & Business Operations)
    -- =====================================================
    ${JOURNAL_SCHEMA}
  `);
}

export function ensureVectorTables(db: Database.Database, dimensions: number): void {
  const existingDims = db
    .prepare(
      `
    SELECT sql FROM sqlite_master
    WHERE type='table' AND name='knowledge_vec'
  `
    )
    .get() as { sql?: string } | undefined;

  if (existingDims?.sql && !existingDims.sql.includes(`[${dimensions}]`)) {
    db.exec(`DROP TABLE IF EXISTS knowledge_vec`);
    db.exec(`DROP TABLE IF EXISTS tg_messages_vec`);
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[${dimensions}] distance_metric=cosine
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tg_messages_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding FLOAT[${dimensions}] distance_metric=cosine
    );
  `);
}

export function getSchemaVersion(db: Database.Database): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSchemaVersion(db: Database.Database, version: string): void {
  db.prepare(
    `
    INSERT INTO meta (key, value, updated_at)
    VALUES ('schema_version', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `
  ).run(version);
}

export const CURRENT_SCHEMA_VERSION = "1.13.0";

export function runMigrations(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);
  if (!currentVersion || versionLessThan(currentVersion, "1.1.0")) {
    log.info("Running migration: Adding scheduled task columns...");

    try {
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
        .get();

      if (!tableExists) {
        log.info("Tasks table doesn't exist yet, skipping column migration");
        setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
        return;
      }

      const tableInfo = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      const existingColumns = tableInfo.map((col) => col.name);
      if (!existingColumns.includes("scheduled_for")) {
        db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_for INTEGER`);
      }
      if (!existingColumns.includes("payload")) {
        db.exec(`ALTER TABLE tasks ADD COLUMN payload TEXT`);
      }
      if (!existingColumns.includes("reason")) {
        db.exec(`ALTER TABLE tasks ADD COLUMN reason TEXT`);
      }
      if (!existingColumns.includes("scheduled_message_id")) {
        db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_message_id INTEGER`);
      }

      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_for) WHERE scheduled_for IS NOT NULL`
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
          task_id TEXT NOT NULL,
          depends_on_task_id TEXT NOT NULL,
          PRIMARY KEY (task_id, depends_on_task_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_deps_parent ON task_dependencies(depends_on_task_id);
      `);

      log.info("Migration 1.1.0 complete: Scheduled tasks support added");
    } catch (error) {
      log.error({ err: error }, "Migration 1.1.0 failed");
      throw error;
    }
  }
  if (!currentVersion || versionLessThan(currentVersion, "1.2.0")) {
    try {
      log.info("Running migration 1.2.0: Extend sessions table for SQLite backend");

      // Add missing columns to sessions table
      const addColumnIfNotExists = (table: string, column: string, type: string) => {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        } catch (e: any) {
          if (!e.message.includes("duplicate column name")) {
            throw e;
          }
        }
      };

      addColumnIfNotExists(
        "sessions",
        "updated_at",
        "INTEGER NOT NULL DEFAULT (unixepoch() * 1000)"
      );
      addColumnIfNotExists("sessions", "last_message_id", "INTEGER");
      addColumnIfNotExists("sessions", "last_channel", "TEXT");
      addColumnIfNotExists("sessions", "last_to", "TEXT");
      addColumnIfNotExists("sessions", "context_tokens", "INTEGER");
      addColumnIfNotExists("sessions", "model", "TEXT");
      addColumnIfNotExists("sessions", "provider", "TEXT");
      addColumnIfNotExists("sessions", "last_reset_date", "TEXT");

      const sessions = db.prepare("SELECT started_at FROM sessions LIMIT 1").all() as Array<{
        started_at: number;
      }>;
      if (sessions.length > 0 && sessions[0].started_at < 1000000000000) {
        db.exec(
          "UPDATE sessions SET started_at = started_at * 1000 WHERE started_at < 1000000000000"
        );
      }

      db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)");

      log.info("Migration 1.2.0 complete: Sessions table extended");
    } catch (error) {
      log.error({ err: error }, "Migration 1.2.0 failed");
      throw error;
    }
  }
  if (!currentVersion || versionLessThan(currentVersion, "1.9.0")) {
    log.info("Running migration 1.9.0: Upgrade embedding_cache to BLOB storage");
    try {
      db.exec(`DROP TABLE IF EXISTS embedding_cache`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (
          hash TEXT NOT NULL,
          model TEXT NOT NULL,
          provider TEXT NOT NULL,
          embedding BLOB NOT NULL,
          dims INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (hash, model, provider)
        );
        CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed ON embedding_cache(accessed_at);
      `);
      log.info("Migration 1.9.0 complete: embedding_cache upgraded to BLOB storage");
    } catch (error) {
      log.error({ err: error }, "Migration 1.9.0 failed");
      throw error;
    }
  }

  if (!currentVersion || versionLessThan(currentVersion, "1.10.0")) {
    log.info("Running migration 1.10.0: Add tool_config table for runtime tool management");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_config (
          tool_name TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          scope TEXT CHECK(scope IN ('always', 'dm-only', 'group-only', 'admin-only')),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_by INTEGER
        );
      `);
      log.info("Migration 1.10.0 complete: tool_config table created");
    } catch (error) {
      log.error({ err: error }, "Migration 1.10.0 failed");
      throw error;
    }
  }

  if (!currentVersion || versionLessThan(currentVersion, "1.10.1")) {
    log.info("Running migration 1.10.1: Fix tool_config scope CHECK constraint (add admin-only)");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS tool_config_new (
            tool_name TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
            scope TEXT CHECK(scope IN ('always', 'dm-only', 'group-only', 'admin-only')),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_by INTEGER
          );
          INSERT OR IGNORE INTO tool_config_new SELECT * FROM tool_config;
          DROP TABLE tool_config;
          ALTER TABLE tool_config_new RENAME TO tool_config;
        `);
      })();
      log.info("Migration 1.10.1 complete: tool_config CHECK constraint updated");
    } catch (error) {
      log.error({ err: error }, "Migration 1.10.1 failed");
      throw error;
    }
  }

  if (!currentVersion || versionLessThan(currentVersion, "1.11.0")) {
    log.info("Running migration 1.11.0: Add tool_index tables for Tool RAG");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_index (
          name TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          search_text TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS tool_index_fts USING fts5(
          search_text,
          name UNINDEXED,
          content='tool_index',
          content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS tool_index_fts_insert AFTER INSERT ON tool_index BEGIN
          INSERT INTO tool_index_fts(rowid, search_text, name)
          VALUES (new.rowid, new.search_text, new.name);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_index_fts_delete AFTER DELETE ON tool_index BEGIN
          DELETE FROM tool_index_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS tool_index_fts_update AFTER UPDATE ON tool_index BEGIN
          DELETE FROM tool_index_fts WHERE rowid = old.rowid;
          INSERT INTO tool_index_fts(rowid, search_text, name)
          VALUES (new.rowid, new.search_text, new.name);
        END;
      `);
      log.info("Migration 1.11.0 complete: tool_index tables created");
    } catch (error) {
      log.error({ err: error }, "Migration 1.11.0 failed");
      throw error;
    }
  }

  if (!currentVersion || versionLessThan(currentVersion, "1.12.0")) {
    log.info("Running migration 1.12.0: Add exec_audit table");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS exec_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
          user_id INTEGER NOT NULL,
          username TEXT,
          tool TEXT NOT NULL,
          command TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          exit_code INTEGER,
          signal TEXT,
          duration_ms INTEGER,
          stdout TEXT,
          stderr TEXT,
          truncated INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_exec_audit_timestamp ON exec_audit(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_exec_audit_user ON exec_audit(user_id);
      `);
      log.info("Migration 1.12.0 complete: exec_audit table created");
    } catch (error) {
      log.error({ err: error }, "Migration 1.12.0 failed");
      throw error;
    }
  }

  if (!currentVersion || versionLessThan(currentVersion, "1.13.0")) {
    log.info("Running migration 1.13.0: Add token usage columns to sessions");
    try {
      const addColumnIfNotExists = (table: string, column: string, type: string) => {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        } catch (e: any) {
          if (!e.message.includes("duplicate column name")) {
            throw e;
          }
        }
      };

      addColumnIfNotExists("sessions", "input_tokens", "INTEGER DEFAULT 0");
      addColumnIfNotExists("sessions", "output_tokens", "INTEGER DEFAULT 0");

      log.info("Migration 1.13.0 complete: Token usage columns added to sessions");
    } catch (error) {
      log.error({ err: error }, "Migration 1.13.0 failed");
      throw error;
    }
  }

  setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
}
