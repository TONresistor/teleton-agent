/**
 * Plugin KV storage — simple key-value persistence without SQL boilerplate.
 *
 * Uses the plugin's isolated SQLite DB with an auto-created `_kv` table.
 * Values are JSON-serialized. Optional TTL for auto-expiration.
 *
 * @example
 * ```typescript
 * sdk.storage.set("last_run", Date.now());
 * const ts = sdk.storage.get<number>("last_run");
 * sdk.storage.set("cache", data, { ttl: 300_000 }); // 5 min TTL
 * ```
 */

import type Database from "better-sqlite3";
import type { StorageSDK } from "@teleton-agent/sdk";

const KV_TABLE = "_kv";
const CLEANUP_PROBABILITY = 0.05; // 5% chance per read to cleanup expired

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${KV_TABLE} (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER
    )
  `);
}

export function createStorageSDK(db: Database.Database): StorageSDK {
  ensureTable(db);

  // Prepared statements (cached for performance)
  const stmtGet = db.prepare(`SELECT value, expires_at FROM ${KV_TABLE} WHERE key = ?`);
  const stmtSet = db.prepare(
    `INSERT OR REPLACE INTO ${KV_TABLE} (key, value, expires_at) VALUES (?, ?, ?)`
  );
  const stmtDel = db.prepare(`DELETE FROM ${KV_TABLE} WHERE key = ?`);
  const stmtHas = db.prepare(`SELECT 1 FROM ${KV_TABLE} WHERE key = ?`);
  const stmtClear = db.prepare(`DELETE FROM ${KV_TABLE}`);
  const stmtCleanup = db.prepare(
    `DELETE FROM ${KV_TABLE} WHERE expires_at IS NOT NULL AND expires_at < ?`
  );

  function maybeCleanup(): void {
    if (Math.random() < CLEANUP_PROBABILITY) {
      stmtCleanup.run(Date.now());
    }
  }

  return {
    get<T>(key: string): T | undefined {
      maybeCleanup();
      const row = stmtGet.get(key) as { value: string; expires_at: number | null } | undefined;
      if (!row) return undefined;
      if (row.expires_at !== null && row.expires_at < Date.now()) {
        stmtDel.run(key);
        return undefined;
      }
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return row.value as unknown as T;
      }
    },

    set<T>(key: string, value: T, opts?: { ttl?: number }): void {
      const serialized = JSON.stringify(value);
      const expiresAt = opts?.ttl ? Date.now() + opts.ttl : null;
      stmtSet.run(key, serialized, expiresAt);
    },

    delete(key: string): boolean {
      const result = stmtDel.run(key);
      return result.changes > 0;
    },

    has(key: string): boolean {
      const row = stmtGet.get(key) as { value: string; expires_at: number | null } | undefined;
      if (!row) return false;
      if (row.expires_at !== null && row.expires_at < Date.now()) {
        stmtDel.run(key);
        return false;
      }
      return true;
    },

    clear(): void {
      stmtClear.run();
    },
  };
}
