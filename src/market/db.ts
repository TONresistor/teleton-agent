import Database from "better-sqlite3";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";

const DB_PATH = join(TELETON_ROOT, "gifts.db");

/**
 * Get database connection
 */
export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

/**
 * Get all collections
 */
export function getCollections(db: Database.Database): any[] {
  return db.prepare("SELECT * FROM gift_collections ORDER BY floor_ton DESC").all();
}

/**
 * Get models for a collection
 */
export function getModels(db: Database.Database, collectionId: number): any[] {
  return db
    .prepare("SELECT * FROM gift_models WHERE collection_id = ? ORDER BY floor_ton ASC")
    .all(collectionId);
}

/**
 * Get database stats
 */
export function getStats(db: Database.Database): {
  collections: number;
  models: number;
  historyEntries: number;
  lastUpdate: string | null;
} {
  const collections = db.prepare("SELECT COUNT(*) as count FROM gift_collections").get() as any;
  const models = db.prepare("SELECT COUNT(*) as count FROM gift_models").get() as any;
  const history = db.prepare("SELECT COUNT(*) as count FROM price_history").get() as any;
  const lastUpdate = db
    .prepare("SELECT MAX(updated_at) as last FROM gift_collections")
    .get() as any;

  return {
    collections: collections.count,
    models: models.count,
    historyEntries: history.count,
    lastUpdate: lastUpdate.last,
  };
}
