import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import {
  openModuleDb,
  JOURNAL_SCHEMA,
  USED_TRANSACTIONS_SCHEMA,
  migrateFromMainDb,
} from "../utils/module-db.js";
import type Database from "better-sqlite3";

const DB_PATH = join(TELETON_ROOT, "casino.db");

let db: Database.Database | null = null;

export function openCasinoDb(): Database.Database {
  if (db) return db;
  db = openModuleDb(DB_PATH);

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

    ${USED_TRANSACTIONS_SCHEMA}

    CREATE TABLE IF NOT EXISTS casino_cooldowns (
      user_id TEXT PRIMARY KEY,
      last_spin_at INTEGER NOT NULL
    );

    ${JOURNAL_SCHEMA}
  `);

  // One-time migration from memory.db (existing users)
  migrateFromMainDb(db, ["casino_users", "used_transactions", "casino_cooldowns"]);

  return db;
}

export function closeCasinoDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getCasinoDb(): Database.Database | null {
  return db;
}
