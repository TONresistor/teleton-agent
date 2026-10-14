/**
 * User hook config store — CRUD for user_hook_config table.
 * Key-value store for keyword blocklist and context trigger configuration.
 */

import type Database from "better-sqlite3";

export interface TriggerEntry {
  id: string;
  keyword: string;
  context: string;
  enabled: boolean;
}

export interface BlocklistConfig {
  enabled: boolean;
  keywords: string[];
  message: string;
}

export function getUserHookConfig(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM user_hook_config WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserHookConfig(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_hook_config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(key, value);
}

export function getBlocklistConfig(db: Database.Database): BlocklistConfig {
  const enabled = getUserHookConfig(db, "blocklist.enabled");
  const keywords = getUserHookConfig(db, "blocklist.keywords");
  const message = getUserHookConfig(db, "blocklist.message");
  return {
    enabled: enabled === "true",
    keywords: keywords ? JSON.parse(keywords) : [],
    message: message ?? "",
  };
}

export function setBlocklistConfig(db: Database.Database, config: BlocklistConfig): void {
  setUserHookConfig(db, "blocklist.enabled", String(config.enabled));
  setUserHookConfig(db, "blocklist.keywords", JSON.stringify(config.keywords));
  setUserHookConfig(db, "blocklist.message", config.message);
}

export function getTriggersConfig(db: Database.Database): TriggerEntry[] {
  const raw = getUserHookConfig(db, "triggers");
  return raw ? JSON.parse(raw) : [];
}

export function setTriggersConfig(db: Database.Database, triggers: TriggerEntry[]): void {
  setUserHookConfig(db, "triggers", JSON.stringify(triggers));
}
