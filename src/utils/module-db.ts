/**
 * Shared utilities for module-scoped SQLite databases.
 * Eliminates schema duplication between module database files (deals/db.ts, etc.)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { ToolExecutor } from "../agent/tools/types.js";
import { TELETON_ROOT } from "../workspace/paths.js";

// ─── Shared Schema Fragments ────────────────────────────────────────

/** Standard journal table schema (shared by all modules & core) */
export const JOURNAL_SCHEMA = `
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
`;

/** Standard used_transactions table for TX replay protection */
export const USED_TRANSACTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS used_transactions (
    tx_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    game_type TEXT NOT NULL,
    used_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_used_tx_user ON used_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_used_tx_used_at ON used_transactions(used_at);
`;

// ─── DB Lifecycle Helpers ───────────────────────────────────────────

/**
 * Open a module-scoped SQLite database with standard settings.
 * Creates parent directories if needed, enables WAL mode.
 */
export function openModuleDb(path: string): Database.Database {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return db;
}

// ─── Tool Executor Wrapper ──────────────────────────────────────────

/**
 * Create a withModuleDb wrapper for a module.
 * Swaps context.db with the module's own DB before calling the executor.
 */
export function createDbWrapper(getDb: () => Database.Database | null, moduleName: string) {
  return function withDb<T>(executor: ToolExecutor<T>): ToolExecutor<any> {
    return (params, context) => {
      const moduleDb = getDb();
      if (!moduleDb) {
        return Promise.resolve({
          success: false,
          error: `${moduleName} module not started`,
        });
      }
      return executor(params, { ...context, db: moduleDb });
    };
  };
}

// ─── Data Migration ─────────────────────────────────────────────────

const MAIN_DB_PATH = join(TELETON_ROOT, "memory.db");

/**
 * One-time migration: copy rows from memory.db into a module DB.
 * Safe to call multiple times — skips if any target table already has data.
 * Uses SQLite ATTACH for efficient cross-database copy.
 */
export function migrateFromMainDb(moduleDb: Database.Database, tables: string[]): number {
  let totalMigrated = 0;

  // Validate table names to prevent SQL injection via interpolation
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) {
      throw new Error(`Invalid table name for migration: "${table}"`);
    }
  }

  // Skip if any target table already has data (= already migrated)
  for (const table of tables) {
    try {
      const row = moduleDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      if (row.c > 0) return 0;
    } catch {
      continue;
    }
  }

  if (!existsSync(MAIN_DB_PATH)) return 0;

  try {
    moduleDb.exec(`ATTACH DATABASE '${MAIN_DB_PATH}' AS main_db`);

    for (const table of tables) {
      try {
        const exists = moduleDb
          .prepare(`SELECT name FROM main_db.sqlite_master WHERE type='table' AND name=?`)
          .get(table);
        if (!exists) continue;

        const src = moduleDb.prepare(`SELECT COUNT(*) as c FROM main_db.${table}`).get() as {
          c: number;
        };
        if (src.c === 0) continue;

        moduleDb.exec(`INSERT OR IGNORE INTO ${table} SELECT * FROM main_db.${table}`);
        totalMigrated += src.c;
        console.log(`  📦 Migrated ${src.c} rows from memory.db → ${table}`);
      } catch (e) {
        console.warn(`  ⚠️ Could not migrate table ${table}:`, e);
      }
    }

    moduleDb.exec(`DETACH DATABASE main_db`);
  } catch (e) {
    console.warn(`⚠️ Migration from memory.db failed:`, e);
    try {
      moduleDb.exec(`DETACH DATABASE main_db`);
    } catch {
      /* already detached */
    }
  }

  return totalMigrated;
}
