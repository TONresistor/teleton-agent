/**
 * Session Store - SQLite backend
 *
 * Migrated from JSON file to SQLite for better scalability (O(1) lookups vs O(n))
 */

import { randomUUID } from "crypto";
import type { SessionResetPolicy } from "../config/schema.js";
import { getDatabase } from "../memory/index.js";
import type Database from "better-sqlite3";

export interface SessionEntry {
  sessionId: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageId?: number;
  lastChannel?: string;
  lastTo?: string;
  contextTokens?: number;
  model?: string;
  provider?: string;
  lastResetDate?: string; // YYYY-MM-DD of last daily reset
}

export type SessionStore = Record<string, SessionEntry>;

/**
 * Get database connection
 */
function getDb(): Database.Database {
  return getDatabase().getDb();
}

/**
 * Convert DB row to SessionEntry
 */
function rowToSession(row: any): SessionEntry {
  return {
    sessionId: row.id,
    chatId: row.chat_id,
    createdAt: row.started_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count || 0,
    lastMessageId: row.last_message_id,
    lastChannel: row.last_channel,
    lastTo: row.last_to,
    contextTokens: row.context_tokens,
    model: row.model,
    provider: row.provider,
    lastResetDate: row.last_reset_date,
  };
}

/**
 * Load sessions from database (for migration/backup compatibility)
 */
export function loadSessionStore(): SessionStore {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM sessions").all() as any[];

    const store: SessionStore = {};
    for (const row of rows) {
      const sessionKey = row.chat_id;
      store[sessionKey] = rowToSession(row);
    }

    return store;
  } catch (error) {
    console.warn("Failed to load sessions from database:", error);
    return {};
  }
}

/**
 * Save sessions to database (for migration/backup compatibility)
 */
export function saveSessionStore(store: SessionStore): void {
  try {
    const db = getDb();

    // Clear existing sessions and insert all
    db.prepare("DELETE FROM sessions").run();

    const insertStmt = db.prepare(`
      INSERT INTO sessions (
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
        session.messageCount,
        session.lastMessageId,
        session.lastChannel,
        session.lastTo,
        session.contextTokens,
        session.model,
        session.provider,
        session.lastResetDate
      );
    }
  } catch (error) {
    console.error("Failed to save sessions to database:", error);
  }
}

/**
 * Get or create session for a chat
 */
export function getOrCreateSession(chatId: string): SessionEntry {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  // Try to get existing session
  const row = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as any;

  if (row) {
    return rowToSession(row);
  }

  // Create new session
  const now = Date.now();
  const newSession: SessionEntry = {
    sessionId: randomUUID(),
    chatId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    lastChannel: "telegram",
    lastTo: chatId,
  };

  db.prepare(
    `
    INSERT INTO sessions (
      id, chat_id, started_at, updated_at, message_count, last_channel, last_to
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    newSession.sessionId,
    sessionKey,
    newSession.createdAt,
    newSession.updatedAt,
    newSession.messageCount,
    newSession.lastChannel,
    newSession.lastTo
  );

  console.log(`📝 New session created: ${newSession.sessionId} for chat ${chatId}`);

  return newSession;
}

/**
 * Update session metadata
 * Note: sessionId CAN be updated for compaction, but chatId and createdAt cannot
 */
export function updateSession(
  chatId: string,
  update: Partial<Omit<SessionEntry, "chatId" | "createdAt">>
): SessionEntry {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  // Get existing session or create
  const existing = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as any;

  if (!existing) {
    return getOrCreateSession(chatId);
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: any[] = [];

  if (update.sessionId !== undefined) {
    updates.push("id = ?");
    values.push(update.sessionId);
  }
  if (update.messageCount !== undefined) {
    updates.push("message_count = ?");
    values.push(update.messageCount);
  }
  if (update.lastMessageId !== undefined) {
    updates.push("last_message_id = ?");
    values.push(update.lastMessageId);
  }
  if (update.lastChannel !== undefined) {
    updates.push("last_channel = ?");
    values.push(update.lastChannel);
  }
  if (update.lastTo !== undefined) {
    updates.push("last_to = ?");
    values.push(update.lastTo);
  }
  if (update.contextTokens !== undefined) {
    updates.push("context_tokens = ?");
    values.push(update.contextTokens);
  }
  if (update.model !== undefined) {
    updates.push("model = ?");
    values.push(update.model);
  }
  if (update.provider !== undefined) {
    updates.push("provider = ?");
    values.push(update.provider);
  }
  if (update.lastResetDate !== undefined) {
    updates.push("last_reset_date = ?");
    values.push(update.lastResetDate);
  }

  // Always update updatedAt
  updates.push("updated_at = ?");
  values.push(Date.now());

  // Add WHERE clause
  values.push(sessionKey);

  db.prepare(
    `
    UPDATE sessions
    SET ${updates.join(", ")}
    WHERE chat_id = ?
  `
  ).run(...values);

  // Return updated session
  const updated = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as any;
  return rowToSession(updated);
}

/**
 * Increment message count for session
 */
export function incrementMessageCount(chatId: string): void {
  const session = getOrCreateSession(chatId);
  updateSession(chatId, {
    messageCount: session.messageCount + 1,
  });
}

/**
 * Get session by chat ID
 */
export function getSession(chatId: string): SessionEntry | null {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;
  const row = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as any;

  return row ? rowToSession(row) : null;
}

/**
 * Reset session (create new sessionId, keep metadata)
 */
export function resetSession(chatId: string): SessionEntry {
  const oldSession = getSession(chatId);
  const now = Date.now();

  const newSession: SessionEntry = {
    sessionId: randomUUID(),
    chatId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    lastChannel: oldSession?.lastChannel || "telegram",
    lastTo: oldSession?.lastTo || chatId,
    contextTokens: oldSession?.contextTokens,
    model: oldSession?.model,
    provider: oldSession?.provider,
  };

  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  // Update existing session with new ID and reset counters
  db.prepare(
    `
    UPDATE sessions
    SET id = ?, started_at = ?, updated_at = ?, message_count = 0
    WHERE chat_id = ?
  `
  ).run(newSession.sessionId, newSession.createdAt, newSession.updatedAt, sessionKey);

  console.log(`🔄 Session reset: ${oldSession?.sessionId} → ${newSession.sessionId}`);

  return newSession;
}

/**
 * Check if session should be reset based on policy
 */
export function shouldResetSession(session: SessionEntry, policy: SessionResetPolicy): boolean {
  const now = Date.now();

  // Check daily reset policy
  if (policy.daily_reset_enabled) {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const lastReset =
      session.lastResetDate || new Date(session.createdAt).toISOString().split("T")[0];

    if (lastReset !== today) {
      // Check if we've passed the reset hour
      const currentHour = new Date().getHours();
      const resetHour = policy.daily_reset_hour;

      // If it's a new day and we're past the reset hour, reset
      if (lastReset < today && currentHour >= resetHour) {
        console.log(
          `📅 Daily reset triggered for session ${session.sessionId} (last reset: ${lastReset})`
        );
        return true;
      }
    }
  }

  // Check idle expiry policy
  if (policy.idle_expiry_enabled) {
    const idleMs = now - session.updatedAt;
    const idleMinutes = idleMs / (1000 * 60);
    const expiryMinutes = policy.idle_expiry_minutes;

    if (idleMinutes >= expiryMinutes) {
      console.log(
        `⏱️  Idle expiry triggered for session ${session.sessionId} (idle: ${Math.floor(idleMinutes)}m)`
      );
      return true;
    }
  }

  return false;
}

/**
 * Reset session and update lastResetDate
 */
export function resetSessionWithPolicy(chatId: string, policy: SessionResetPolicy): SessionEntry {
  const newSession = resetSession(chatId);
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  return updateSession(chatId, {
    lastResetDate: today,
  });
}
