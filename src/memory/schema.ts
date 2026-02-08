import type Database from "better-sqlite3";

/**
 * Compare two semver version strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 *
 * Handles versions like "1.0.0", "1.10.0", "2.0.0-beta"
 */
function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string) => {
    // Extract numeric parts, ignore pre-release suffixes for comparison
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

/**
 * Check if version a is less than version b using proper semver comparison
 */
function versionLessThan(a: string, b: string): boolean {
  return compareSemver(a, b) < 0;
}

/**
 * Complete SQLite schema for Tonnet Memory System
 *
 * Two main subsystems:
 * 1. Agent Memory - What the agent knows (MEMORY.md, sessions, tasks)
 * 2. Telegram Feed - What the agent sees (all Telegram messages)
 */

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
      last_reset_date TEXT               -- YYYY-MM-DD of last daily reset
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
      hash TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      dims INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      accessed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(provider, model);
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed ON embedding_cache(accessed_at);

    -- =====================================================
    -- CASINO
    -- =====================================================

    CREATE TABLE IF NOT EXISTS casino_users (
      telegram_id TEXT PRIMARY KEY,
      wallet_address TEXT,
      total_bets INTEGER NOT NULL DEFAULT 0,
      total_wagered REAL NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      total_won REAL NOT NULL DEFAULT 0,
      last_bet_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS used_transactions (
      tx_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      game_type TEXT NOT NULL,
      used_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_used_tx_user ON used_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_used_tx_used_at ON used_transactions(used_at);

    CREATE TABLE IF NOT EXISTS casino_cooldowns (
      user_id TEXT PRIMARY KEY,
      last_spin_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS casino_jackpot (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      amount REAL NOT NULL DEFAULT 0,
      last_awarded_at INTEGER,
      last_winner_id TEXT,
      last_winner_amount REAL
    );

    -- Insert default jackpot row
    INSERT OR IGNORE INTO casino_jackpot (id, amount) VALUES (1, 0);

    -- =====================================================
    -- JOURNAL (Trading & Business Operations)
    -- =====================================================

    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      type TEXT NOT NULL CHECK(type IN ('trade', 'gift', 'middleman', 'kol')),
      action TEXT NOT NULL,
      asset_from TEXT,
      asset_to TEXT,
      amount_from REAL,
      amount_to REAL,
      price_ton REAL,
      counterparty TEXT,
      platform TEXT,
      reasoning TEXT,
      outcome TEXT CHECK(outcome IN ('pending', 'profit', 'loss', 'neutral', 'cancelled')),
      pnl_ton REAL,
      pnl_pct REAL,
      tx_hash TEXT,
      tool_used TEXT,
      chat_id TEXT,
      user_id INTEGER,
      closed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_journal_type ON journal(type);
    CREATE INDEX IF NOT EXISTS idx_journal_timestamp ON journal(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_journal_asset_from ON journal(asset_from);
    CREATE INDEX IF NOT EXISTS idx_journal_outcome ON journal(outcome);
    CREATE INDEX IF NOT EXISTS idx_journal_type_timestamp ON journal(type, timestamp DESC);
  `);
}

/**
 * Create vector tables using sqlite-vec extension
 * Must be called after loading the vec0 extension
 */
export function ensureVectorTables(db: Database.Database, dimensions: number): void {
  // Drop existing tables if dimensions changed
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

  // Create vector tables with cosine distance metric
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

/**
 * Get schema version
 */
export function getSchemaVersion(db: Database.Database): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Set schema version
 */
export function setSchemaVersion(db: Database.Database, version: string): void {
  db.prepare(
    `
    INSERT INTO meta (key, value, updated_at)
    VALUES ('schema_version', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `
  ).run(version);
}

export const CURRENT_SCHEMA_VERSION = "1.7.0";

/**
 * Run migrations to upgrade existing database schema
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);

  // Migration: 1.0.0 → 1.1.0 (Add scheduled tasks support)
  if (!currentVersion || versionLessThan(currentVersion, "1.1.0")) {
    console.log("📦 Running migration: Adding scheduled task columns...");

    try {
      // Check if tasks table exists
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
        .get();

      if (!tableExists) {
        console.log("  Tasks table doesn't exist yet, skipping column migration");
        // The ensureSchema call will create the table with all columns
        setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
        return;
      }

      // Check if columns exist before adding (SQLite doesn't support IF NOT EXISTS for columns)
      const tableInfo = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      const existingColumns = tableInfo.map((col) => col.name);

      // Add new columns to tasks table
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

      // Create scheduled_for index if not exists
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_for) WHERE scheduled_for IS NOT NULL`
      );

      // Create task_dependencies table
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

      console.log("✅ Migration 1.1.0 complete: Scheduled tasks support added");
    } catch (error) {
      console.error("❌ Migration 1.1.0 failed:", error);
      throw error;
    }
  }

  // Migration 1.2.0: Extend sessions table
  if (!currentVersion || versionLessThan(currentVersion, "1.2.0")) {
    try {
      console.log("🔄 Running migration 1.2.0: Extend sessions table for SQLite backend");

      // Add missing columns to sessions table
      const addColumnIfNotExists = (table: string, column: string, type: string) => {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        } catch (e: any) {
          // Ignore if column already exists
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

      // Rename started_at to match createdAt semantics (store ms timestamps)
      // SQLite doesn't support MODIFY COLUMN, so we check if it needs adjustment
      const sessions = db.prepare("SELECT started_at FROM sessions LIMIT 1").all() as any[];
      if (sessions.length > 0 && sessions[0].started_at < 1000000000000) {
        // Old format: Unix epoch in seconds, convert to milliseconds
        db.exec(
          "UPDATE sessions SET started_at = started_at * 1000 WHERE started_at < 1000000000000"
        );
      }

      // Create updated_at index
      db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)");

      console.log("✅ Migration 1.2.0 complete: Sessions table extended");
    } catch (error) {
      console.error("❌ Migration 1.2.0 failed:", error);
      throw error;
    }
  }

  // Migration 1.5.0: Deals system
  if (!currentVersion || versionLessThan(currentVersion, "1.5.0")) {
    try {
      console.log("🔄 Running migration 1.5.0: Add deals system for secure trading");

      db.exec(`
        CREATE TABLE IF NOT EXISTS deals (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status IN (
            'proposed', 'accepted', 'payment_claimed', 'verified', 'completed',
            'declined', 'expired', 'cancelled', 'failed'
          )),

          -- Parties
          user_telegram_id INTEGER NOT NULL,
          user_username TEXT,
          chat_id TEXT NOT NULL,
          proposal_message_id INTEGER,

          -- What USER gives
          user_gives_type TEXT NOT NULL CHECK(user_gives_type IN ('ton', 'gift')),
          user_gives_ton_amount REAL,
          user_gives_gift_id TEXT,
          user_gives_gift_slug TEXT,
          user_gives_value_ton REAL NOT NULL,

          -- What AGENT gives
          agent_gives_type TEXT NOT NULL CHECK(agent_gives_type IN ('ton', 'gift')),
          agent_gives_ton_amount REAL,
          agent_gives_gift_id TEXT,
          agent_gives_gift_slug TEXT,
          agent_gives_value_ton REAL NOT NULL,

          -- Payment/Gift verification
          user_payment_verified_at INTEGER,
          user_payment_tx_hash TEXT,
          user_payment_gift_msgid TEXT,
          user_payment_wallet TEXT,

          -- Agent send tracking
          agent_sent_at INTEGER,
          agent_sent_tx_hash TEXT,
          agent_sent_gift_msgid TEXT,

          -- Business logic
          strategy_check TEXT,
          profit_ton REAL,

          -- Timestamps
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL,
          completed_at INTEGER,

          notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
        CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_telegram_id);
        CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id);
        CREATE INDEX IF NOT EXISTS idx_deals_expires ON deals(expires_at)
          WHERE status IN ('proposed', 'accepted');
      `);

      console.log("✅ Migration 1.5.0 complete: Deals system added");
    } catch (error) {
      console.error("❌ Migration 1.5.0 failed:", error);
      throw error;
    }
  }

  // Migration 1.6.0: Bot inline message tracking + payment_claimed status
  if (!currentVersion || versionLessThan(currentVersion, "1.6.0")) {
    try {
      console.log("🔄 Running migration 1.6.0: Add bot inline tracking + payment_claimed status");

      // Check if deals table exists
      const dealsExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deals'")
        .get();

      if (dealsExists) {
        // Check if CHECK constraint already includes payment_claimed
        const tableSql =
          (
            db
              .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='deals'")
              .get() as { sql: string }
          )?.sql || "";

        if (!tableSql.includes("payment_claimed")) {
          // Recreate table with updated CHECK constraint (explicit columns, no SELECT *)
          db.exec(`
            ALTER TABLE deals RENAME TO deals_old;

            CREATE TABLE deals (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL CHECK(status IN (
                'proposed', 'accepted', 'payment_claimed', 'verified', 'completed',
                'declined', 'expired', 'cancelled', 'failed'
              )),
              user_telegram_id INTEGER NOT NULL,
              user_username TEXT,
              chat_id TEXT NOT NULL,
              proposal_message_id INTEGER,
              user_gives_type TEXT NOT NULL CHECK(user_gives_type IN ('ton', 'gift')),
              user_gives_ton_amount REAL,
              user_gives_gift_id TEXT,
              user_gives_gift_slug TEXT,
              user_gives_value_ton REAL NOT NULL,
              agent_gives_type TEXT NOT NULL CHECK(agent_gives_type IN ('ton', 'gift')),
              agent_gives_ton_amount REAL,
              agent_gives_gift_id TEXT,
              agent_gives_gift_slug TEXT,
              agent_gives_value_ton REAL NOT NULL,
              user_payment_verified_at INTEGER,
              user_payment_tx_hash TEXT,
              user_payment_gift_msgid TEXT,
              user_payment_wallet TEXT,
              agent_sent_at INTEGER,
              agent_sent_tx_hash TEXT,
              agent_sent_gift_msgid TEXT,
              strategy_check TEXT,
              profit_ton REAL,
              created_at INTEGER NOT NULL DEFAULT (unixepoch()),
              expires_at INTEGER NOT NULL,
              completed_at INTEGER,
              notes TEXT,
              inline_message_id TEXT,
              payment_claimed_at INTEGER
            );

            INSERT INTO deals (
              id, status, user_telegram_id, user_username, chat_id, proposal_message_id,
              user_gives_type, user_gives_ton_amount, user_gives_gift_id, user_gives_gift_slug, user_gives_value_ton,
              agent_gives_type, agent_gives_ton_amount, agent_gives_gift_id, agent_gives_gift_slug, agent_gives_value_ton,
              user_payment_verified_at, user_payment_tx_hash, user_payment_gift_msgid, user_payment_wallet,
              agent_sent_at, agent_sent_tx_hash, agent_sent_gift_msgid,
              strategy_check, profit_ton, created_at, expires_at, completed_at, notes
            )
            SELECT
              id, status, user_telegram_id, user_username, chat_id, proposal_message_id,
              user_gives_type, user_gives_ton_amount, user_gives_gift_id, user_gives_gift_slug, user_gives_value_ton,
              agent_gives_type, agent_gives_ton_amount, agent_gives_gift_id, agent_gives_gift_slug, agent_gives_value_ton,
              user_payment_verified_at, user_payment_tx_hash, user_payment_gift_msgid, user_payment_wallet,
              agent_sent_at, agent_sent_tx_hash, agent_sent_gift_msgid,
              strategy_check, profit_ton, created_at, expires_at, completed_at, notes
            FROM deals_old;

            DROP TABLE deals_old;

            CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
            CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id);
            CREATE INDEX IF NOT EXISTS idx_deals_inline_msg ON deals(inline_message_id)
              WHERE inline_message_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_deals_payment_claimed ON deals(payment_claimed_at)
              WHERE payment_claimed_at IS NOT NULL;
          `);
        } else {
          // Table already has payment_claimed, just ensure new columns exist
          const columns = db.prepare(`PRAGMA table_info(deals)`).all() as { name: string }[];
          const columnNames = columns.map((c) => c.name);
          if (!columnNames.includes("inline_message_id")) {
            db.exec(`ALTER TABLE deals ADD COLUMN inline_message_id TEXT`);
          }
          if (!columnNames.includes("payment_claimed_at")) {
            db.exec(`ALTER TABLE deals ADD COLUMN payment_claimed_at INTEGER`);
          }
        }
      }

      // User trade stats table
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_trade_stats (
          telegram_id INTEGER PRIMARY KEY,
          username TEXT,
          first_trade_at INTEGER DEFAULT (unixepoch()),
          total_deals INTEGER DEFAULT 0,
          completed_deals INTEGER DEFAULT 0,
          declined_deals INTEGER DEFAULT 0,
          total_ton_sent REAL DEFAULT 0,
          total_ton_received REAL DEFAULT 0,
          total_gifts_sent INTEGER DEFAULT 0,
          total_gifts_received INTEGER DEFAULT 0,
          last_deal_at INTEGER
        );
      `);

      console.log("✅ Migration 1.6.0 complete: Bot inline tracking + payment_claimed added");
    } catch (error) {
      console.error("❌ Migration 1.6.0 failed:", error);
      throw error;
    }
  }

  // Migration 1.7.0: Casino tables (casino_users, used_transactions, cooldowns, jackpot)
  if (!currentVersion || versionLessThan(currentVersion, "1.7.0")) {
    try {
      console.log("🔄 Running migration 1.7.0: Add casino tables");

      db.exec(`
        CREATE TABLE IF NOT EXISTS casino_users (
          telegram_id TEXT PRIMARY KEY,
          wallet_address TEXT,
          total_bets INTEGER NOT NULL DEFAULT 0,
          total_wagered REAL NOT NULL DEFAULT 0,
          total_wins INTEGER NOT NULL DEFAULT 0,
          total_losses INTEGER NOT NULL DEFAULT 0,
          total_won REAL NOT NULL DEFAULT 0,
          last_bet_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS used_transactions (
          tx_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL,
          game_type TEXT NOT NULL,
          used_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_used_tx_user ON used_transactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_used_tx_used_at ON used_transactions(used_at);

        CREATE TABLE IF NOT EXISTS casino_cooldowns (
          user_id TEXT PRIMARY KEY,
          last_spin_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS casino_jackpot (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          amount REAL NOT NULL DEFAULT 0,
          last_awarded_at INTEGER,
          last_winner_id TEXT,
          last_winner_amount REAL
        );

        INSERT OR IGNORE INTO casino_jackpot (id, amount) VALUES (1, 0);
      `);

      console.log("✅ Migration 1.7.0 complete: Casino tables added");
    } catch (error) {
      console.error("❌ Migration 1.7.0 failed:", error);
      throw error;
    }
  }

  // Update schema version
  setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
}
