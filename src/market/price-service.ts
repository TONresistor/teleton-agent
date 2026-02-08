import { getDb, getCollections, getModels, getStats } from "./db.js";
import { MarketScraperService } from "./scraper-service.js";
import type Database from "better-sqlite3";
import type { MarketConfig } from "../config/schema.js";

export interface ModelFloor {
  collection: string;
  collectionAddress: string;
  model: string;
  floorTon: number;
  rarityPercent: number | null;
  count: number | null;
  updatedAt: string;
  cacheAge: number; // milliseconds
}

export interface CollectionFloor {
  name: string;
  address: string;
  floorTon: number;
  floorUsd: number | null;
  volume7d: number | null;
  listedCount: number | null;
  updatedAt: string;
  cacheAge: number;
}

export interface SearchResult {
  collection: string;
  model: string;
  floorTon: number;
  rarityPercent: number | null;
}

/**
 * Smart cache service for MarketApp.ws gift prices
 * - 15-minute cache TTL
 * - On-demand refresh for stale data
 * - Background full refresh every 2 hours (120 minutes)
 */
export class MarketPriceService {
  private db: Database.Database | null = null;
  private scraperService: MarketScraperService;
  private refreshIntervalId: NodeJS.Timeout | null = null;
  private isStarted = false;
  private cacheTtlMs: number;
  private fullRefreshIntervalMs: number;

  constructor(config?: MarketConfig) {
    this.scraperService = new MarketScraperService();
    this.cacheTtlMs = (config?.cache_ttl_minutes ?? 15) * 60 * 1000;
    this.fullRefreshIntervalMs = (config?.refresh_interval_minutes ?? 120) * 60 * 1000;
  }

  /**
   * Start the service with background refresh
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    try {
      // Initialize database connection
      this.db = getDb();

      // Get initial stats
      const stats = getStats(this.db);

      // Check if data is stale (older than 2 hours)
      let dataAgeMs = Infinity;
      let timeUntilNextRefresh = this.fullRefreshIntervalMs;

      if (stats.lastUpdate) {
        // SQLite stores timestamps in UTC without 'Z' suffix, so append it for correct parsing
        const lastUpdateTime = new Date(stats.lastUpdate + "Z").getTime();
        dataAgeMs = Date.now() - lastUpdateTime;

        // Calculate time remaining until next scheduled refresh
        timeUntilNextRefresh = this.fullRefreshIntervalMs - dataAgeMs;

        if (timeUntilNextRefresh < 0) {
          // Data is stale, refresh soon
          timeUntilNextRefresh = 60_000; // 1 minute delay
        }
      }

      console.log(`📊 Market data age: ${Math.round(dataAgeMs / 1000 / 60)} min`);
      console.log(
        `⏰ Full refresh in: ${Math.round(timeUntilNextRefresh / 1000 / 60)} min | Cache refresh: ${this.cacheTtlMs / 60000} min`
      );

      // Schedule first refresh at calculated time
      setTimeout(() => {
        this.backgroundRefresh();

        // After first refresh, schedule regular interval
        this.refreshIntervalId = setInterval(() => {
          this.backgroundRefresh();
        }, this.fullRefreshIntervalMs);
      }, timeUntilNextRefresh);

      this.isStarted = true;
    } catch (error) {
      console.error("Failed to start MarketPriceService:", error);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.isStarted = false;
    console.log("MarketPriceService stopped");
  }

  /**
   * Get floor price for a specific model
   * Automatically refreshes if data is stale (> 15 min)
   */
  async getModelFloor(collectionName: string, modelName: string): Promise<ModelFloor | null> {
    if (!this.db) throw new Error("MarketPriceService not started");

    // Fuzzy search for collection (case-insensitive, partial match)
    const collections = this.db
      .prepare(
        `
      SELECT * FROM gift_collections
      WHERE LOWER(name) LIKE LOWER(?)
      LIMIT 1
    `
      )
      .all(`%${collectionName}%`) as any[];

    if (collections.length === 0) {
      return null;
    }

    const collection = collections[0];

    // Fuzzy search for model
    const models = this.db
      .prepare(
        `
      SELECT * FROM gift_models
      WHERE collection_id = ? AND LOWER(name) LIKE LOWER(?)
      LIMIT 1
    `
      )
      .all(collection.id, `%${modelName}%`) as any[];

    if (models.length === 0) {
      return null;
    }

    const model = models[0];
    const updatedAt = new Date(model.updated_at + "Z");
    const cacheAge = Date.now() - updatedAt.getTime();

    // Check if data is stale
    if (cacheAge > this.cacheTtlMs) {
      console.log(
        `   ⏰ Cache stale for ${collectionName} (${Math.round(cacheAge / 1000 / 60)} min old)`
      );
      // Note: Single-collection refresh not yet implemented
      // Full refresh will update it eventually
    }

    return {
      collection: collection.name,
      collectionAddress: collection.address,
      model: model.name,
      floorTon: model.floor_ton,
      rarityPercent: model.rarity_percent,
      count: model.count,
      updatedAt: model.updated_at,
      cacheAge,
    };
  }

  /**
   * Get floor price for a collection
   */
  async getCollectionFloor(collectionName: string): Promise<CollectionFloor | null> {
    if (!this.db) throw new Error("MarketPriceService not started");

    const collections = this.db
      .prepare(
        `
      SELECT * FROM gift_collections
      WHERE LOWER(name) LIKE LOWER(?)
      LIMIT 1
    `
      )
      .all(`%${collectionName}%`) as any[];

    if (collections.length === 0) {
      return null;
    }

    const col = collections[0];
    const updatedAt = new Date(col.updated_at + "Z");
    const cacheAge = Date.now() - updatedAt.getTime();

    return {
      name: col.name,
      address: col.address,
      floorTon: col.floor_ton,
      floorUsd: col.floor_usd,
      volume7d: col.volume_7d,
      listedCount: col.listed_count,
      updatedAt: col.updated_at,
      cacheAge,
    };
  }

  /**
   * Search models by name (fuzzy search)
   */
  async searchModels(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.db) throw new Error("MarketPriceService not started");

    const results = this.db
      .prepare(
        `
      SELECT c.name as collection, m.name as model, m.floor_ton, m.rarity_percent
      FROM gift_models m
      JOIN gift_collections c ON c.id = m.collection_id
      WHERE LOWER(m.name) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?)
      ORDER BY m.floor_ton ASC
      LIMIT ?
    `
      )
      .all(`%${query}%`, `%${query}%`, limit) as any[];

    return results.map((r) => ({
      collection: r.collection,
      model: r.model,
      floorTon: r.floor_ton,
      rarityPercent: r.rarity_percent,
    }));
  }

  /**
   * Get cheapest models under a certain TON amount
   */
  async getCheapestModels(maxTon: number, limit: number = 20): Promise<SearchResult[]> {
    if (!this.db) throw new Error("MarketPriceService not started");

    const results = this.db
      .prepare(
        `
      SELECT c.name as collection, m.name as model, m.floor_ton, m.rarity_percent
      FROM gift_models m
      JOIN gift_collections c ON c.id = m.collection_id
      WHERE m.floor_ton IS NOT NULL AND m.floor_ton <= ?
      ORDER BY m.floor_ton ASC
      LIMIT ?
    `
      )
      .all(maxTon, limit) as any[];

    return results.map((r) => ({
      collection: r.collection,
      model: r.model,
      floorTon: r.floor_ton,
      rarityPercent: r.rarity_percent,
    }));
  }

  /**
   * Get price history for a model
   */
  async getModelPriceHistory(
    collectionName: string,
    modelName: string,
    limit: number = 10
  ): Promise<any[]> {
    if (!this.db) throw new Error("MarketPriceService not started");

    // Find collection and model
    const collection = this.db
      .prepare(
        `
      SELECT id FROM gift_collections WHERE LOWER(name) LIKE LOWER(?) LIMIT 1
    `
      )
      .get(`%${collectionName}%`) as any;

    if (!collection) return [];

    const model = this.db
      .prepare(
        `
      SELECT id FROM gift_models WHERE collection_id = ? AND LOWER(name) LIKE LOWER(?) LIMIT 1
    `
      )
      .get(collection.id, `%${modelName}%`) as any;

    if (!model) return [];

    // Get history
    return this.db
      .prepare(
        `
      SELECT floor_ton, floor_usd, timestamp
      FROM price_history
      WHERE model_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `
      )
      .all(model.id, limit);
  }

  /**
   * Get service stats
   */
  getStats(): any {
    if (!this.db) throw new Error("MarketPriceService not started");
    return getStats(this.db);
  }

  /**
   * Background refresh (runs every 60 min)
   */
  private async backgroundRefresh(): Promise<void> {
    if (this.scraperService.isScrapingActive()) {
      return;
    }

    const result = await this.scraperService.scrapeFullRefresh();

    if (!result.success) {
      console.error(`Market refresh failed: ${result.error}`);
    }
  }

  /**
   * Manual trigger for full refresh
   */
  async manualRefresh(): Promise<void> {
    await this.backgroundRefresh();
  }
}
