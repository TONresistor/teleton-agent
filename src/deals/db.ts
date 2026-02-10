import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";
import {
  openModuleDb,
  JOURNAL_SCHEMA,
  USED_TRANSACTIONS_SCHEMA,
  migrateFromMainDb,
} from "../utils/module-db.js";
import type Database from "better-sqlite3";

const DB_PATH = join(TELETON_ROOT, "deals.db");

let db: Database.Database | null = null;

export function openDealsDb(): Database.Database {
  if (db) return db;
  db = openModuleDb(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
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

    CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
    CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_telegram_id);
    CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id);
    CREATE INDEX IF NOT EXISTS idx_deals_inline_msg ON deals(inline_message_id) WHERE inline_message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_deals_payment_claimed ON deals(payment_claimed_at) WHERE payment_claimed_at IS NOT NULL;

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

    ${USED_TRANSACTIONS_SCHEMA}

    ${JOURNAL_SCHEMA}
  `);

  // One-time migration from memory.db (existing users)
  migrateFromMainDb(db, ["deals", "user_trade_stats", "used_transactions"]);

  return db;
}

export function closeDealsDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDealsDb(): Database.Database | null {
  return db;
}
