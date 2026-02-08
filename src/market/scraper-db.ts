/**
 * Database functions for gift market scraper
 */

import Database from "better-sqlite3";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";

const DB_PATH = join(TELETON_ROOT, "gifts.db");

export interface Collection {
  address: string;
  name: string;
  floorTON?: number | null;
  floorUSD?: number | null;
  volume7d?: number | null;
}

export interface Model {
  name: string;
  floor: number | null;
  pct: string | null;
  count: number | null;
}

export interface DbStats {
  collections: number;
  models: number;
  historyEntries: number;
  lastUpdate: string | null;
}

/**
 * Initialize database with schema
 */
export function initScraperDb(): Database.Database {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    -- Gift collections (Plush Pepes, Heart Lockets, etc.)
    CREATE TABLE IF NOT EXISTS gift_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      floor_ton REAL,
      floor_usd REAL,
      volume_7d REAL,
      listed_count INTEGER,
      owners INTEGER,
      supply INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Models per collection (Cozy Galaxy, Milano, etc.)
    CREATE TABLE IF NOT EXISTS gift_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      floor_ton REAL,
      rarity_percent REAL,
      count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (collection_id) REFERENCES gift_collections(id),
      UNIQUE(collection_id, name)
    );

    -- Price history (for trends)
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER,
      model_id INTEGER,
      floor_ton REAL NOT NULL,
      floor_usd REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (collection_id) REFERENCES gift_collections(id),
      FOREIGN KEY (model_id) REFERENCES gift_models(id)
    );

    -- Indexes for frequent queries
    CREATE INDEX IF NOT EXISTS idx_price_history_collection ON price_history(collection_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_price_history_model ON price_history(model_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_models_collection ON gift_models(collection_id);
  `);

  return db;
}

/**
 * Upsert collection
 */
export function upsertCollection(db: Database.Database, collection: Collection): number {
  const stmt = db.prepare(`
    INSERT INTO gift_collections (address, name, floor_ton, floor_usd, volume_7d, updated_at)
    VALUES (@address, @name, @floor_ton, @floor_usd, @volume_7d, CURRENT_TIMESTAMP)
    ON CONFLICT(address) DO UPDATE SET
      name = @name,
      floor_ton = @floor_ton,
      floor_usd = @floor_usd,
      volume_7d = @volume_7d,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);

  const result = stmt.get({
    address: collection.address,
    name: collection.name,
    floor_ton: collection.floorTON || null,
    floor_usd: collection.floorUSD || null,
    volume_7d: collection.volume7d || null,
  }) as { id: number };

  return result.id;
}

/**
 * Get collection ID by address (without overwriting price data)
 */
export function getCollectionId(db: Database.Database, address: string): number | null {
  const row = db.prepare(`SELECT id FROM gift_collections WHERE address = ?`).get(address) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

/**
 * Upsert model
 */
export function upsertModel(db: Database.Database, collectionId: number, model: Model): number {
  const stmt = db.prepare(`
    INSERT INTO gift_models (collection_id, name, floor_ton, rarity_percent, count, updated_at)
    VALUES (@collection_id, @name, @floor_ton, @rarity_percent, @count, CURRENT_TIMESTAMP)
    ON CONFLICT(collection_id, name) DO UPDATE SET
      floor_ton = @floor_ton,
      rarity_percent = @rarity_percent,
      count = @count,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `);

  const result = stmt.get({
    collection_id: collectionId,
    name: model.name,
    floor_ton: model.floor || null,
    rarity_percent: model.pct ? parseFloat(model.pct) : null,
    count: model.count || null,
  }) as { id: number };

  return result.id;
}

/**
 * Add price history entry
 */
export function addPriceHistory(
  db: Database.Database,
  collectionId: number,
  modelId: number | null,
  floorTon: number,
  floorUsd: number | null = null
): void {
  const stmt = db.prepare(`
    INSERT INTO price_history (collection_id, model_id, floor_ton, floor_usd)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(collectionId, modelId, floorTon, floorUsd);
}

/**
 * Get database stats
 */
export function getScraperStats(db: Database.Database): DbStats {
  const collections = db.prepare("SELECT COUNT(*) as count FROM gift_collections").get() as {
    count: number;
  };
  const models = db.prepare("SELECT COUNT(*) as count FROM gift_models").get() as { count: number };
  const history = db.prepare("SELECT COUNT(*) as count FROM price_history").get() as {
    count: number;
  };
  const lastUpdate = db.prepare("SELECT MAX(updated_at) as last FROM gift_collections").get() as {
    last: string | null;
  };

  return {
    collections: collections.count,
    models: models.count,
    historyEntries: history.count,
    lastUpdate: lastUpdate.last,
  };
}
