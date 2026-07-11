import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import type { ToolExecutor } from "../agent/tools/types.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { createLogger } from "./logger.js";

const log = createLogger("Utils");
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

export function openModuleDb(path: string): Database.Database {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  try {
    chmodSync(path, 0o600);
  } catch {}
  db.pragma("journal_mode = WAL");
  return db;
}
export function createDbWrapper(getDb: () => Database.Database | null, moduleName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic wrapper erases param type
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

const MAIN_DB_PATH = join(TELETON_ROOT, "memory.db");

/**
 * One-time migration from memory.db. Uses ATTACH for efficient copy.
 * Skips if target tables already have data.
 */
export function migrateFromMainDb(moduleDb: Database.Database, tables: string[]): number {
  let totalMigrated = 0;

  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) {
      throw new Error(`Invalid table name for migration: "${table}"`);
    }
  }
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

        // Use shared columns only (schemas may differ between main DB and plugin DB)
        const dstCols = moduleDb
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r: unknown) => (r as { name: string }).name);
        const srcCols = moduleDb
          .prepare(`PRAGMA main_db.table_info(${table})`)
          .all()
          .map((r: unknown) => (r as { name: string }).name);
        const shared = dstCols.filter((c) => srcCols.includes(c));
        if (shared.length === 0) continue;
        const cols = shared.join(", ");
        moduleDb.exec(
          `INSERT OR IGNORE INTO ${table} (${cols}) SELECT ${cols} FROM main_db.${table}`
        );
        totalMigrated += src.c;
        // Source tables are intentionally left in memory.db (copy-only migration).
        // DROP TABLE was removed to prevent a malformed plugin from deleting core tables.
        log.info(`Migrated ${src.c} rows from memory.db → ${table}`);
      } catch (innerError) {
        log.warn({ err: innerError }, `Could not migrate table ${table}`);
      }
    }

    moduleDb.exec(`DETACH DATABASE main_db`);
  } catch (error) {
    log.warn({ err: error }, `Migration from memory.db failed`);
    try {
      moduleDb.exec(`DETACH DATABASE main_db`);
    } catch {}
  }

  return totalMigrated;
}
