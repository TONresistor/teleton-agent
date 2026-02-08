/**
 * Migration: sessions.json → SQLite
 *
 * Automatically migrates existing sessions.json to database on first run
 */

import { readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { getDatabase } from "../memory/index.js";
import type { SessionEntry } from "./store.js";
import { TELETON_ROOT } from "../workspace/paths.js";

const SESSIONS_JSON = join(TELETON_ROOT, "sessions.json");
const SESSIONS_JSON_BACKUP = join(TELETON_ROOT, "sessions.json.backup");

/**
 * Migrate sessions from JSON to SQLite
 * Returns number of sessions migrated
 */
export function migrateSessionsToDb(): number {
  // Check if JSON file exists
  if (!existsSync(SESSIONS_JSON)) {
    return 0; // No migration needed
  }

  try {
    console.log("🔄 Migrating sessions from JSON to SQLite...");

    // Load JSON file
    const raw = readFileSync(SESSIONS_JSON, "utf-8");
    const store = JSON.parse(raw) as Record<string, SessionEntry>;

    const db = getDatabase().getDb();
    let migrated = 0;

    // Insert each session into database
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, chat_id, started_at, updated_at, message_count,
        last_message_id, last_channel, last_to, context_tokens,
        model, provider, last_reset_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [chatId, session] of Object.entries(store)) {
      insertStmt.run(
        session.sessionId,
        chatId,
        session.createdAt,
        session.updatedAt,
        session.messageCount || 0,
        session.lastMessageId || null,
        session.lastChannel || null,
        session.lastTo || null,
        session.contextTokens || null,
        session.model || null,
        session.provider || null,
        session.lastResetDate || null
      );
      migrated++;
    }

    // Backup original file
    renameSync(SESSIONS_JSON, SESSIONS_JSON_BACKUP);

    console.log(`✅ Migrated ${migrated} sessions to SQLite`);
    console.log(`   Backup saved: ${SESSIONS_JSON_BACKUP}`);

    return migrated;
  } catch (error) {
    console.error("❌ Failed to migrate sessions:", error);
    return 0;
  }
}
