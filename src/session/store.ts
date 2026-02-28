import { randomUUID } from "crypto";
import type { SessionResetPolicy } from "../config/schema.js";
import { getDatabase } from "../memory/index.js";
import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Session");

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
  inputTokens?: number;
  outputTokens?: number;
}

export type SessionStore = Record<string, SessionEntry>;

interface SessionRow {
  id: string;
  chat_id: string;
  started_at: number;
  updated_at: number;
  ended_at: number | null;
  summary: string | null;
  message_count: number;
  tokens_used: number;
  last_message_id: number | null;
  last_channel: string | null;
  last_to: string | null;
  context_tokens: number | null;
  model: string | null;
  provider: string | null;
  last_reset_date: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

function getDb(): Database.Database {
  return getDatabase().getDb();
}
function rowToSession(row: SessionRow): SessionEntry {
  return {
    sessionId: row.id,
    chatId: row.chat_id,
    createdAt: row.started_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count || 0,
    lastMessageId: row.last_message_id ?? undefined,
    lastChannel: row.last_channel ?? undefined,
    lastTo: row.last_to ?? undefined,
    contextTokens: row.context_tokens ?? undefined,
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    lastResetDate: row.last_reset_date ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
  };
}
export function loadSessionStore(): SessionStore {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM sessions").all() as SessionRow[];

    const store: SessionStore = {};
    for (const row of rows) {
      const sessionKey = row.chat_id;
      store[sessionKey] = rowToSession(row);
    }

    return store;
  } catch (error) {
    log.warn({ err: error }, "Failed to load sessions from database");
    return {};
  }
}
export function saveSessionStore(store: SessionStore): void {
  try {
    const db = getDb();

    const insertStmt = db.prepare(`
      INSERT INTO sessions (
        id, chat_id, started_at, updated_at, message_count,
        last_message_id, last_channel, last_to, context_tokens,
        model, provider, last_reset_date, input_tokens, output_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      db.prepare("DELETE FROM sessions").run();

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
          session.lastResetDate,
          session.inputTokens ?? 0,
          session.outputTokens ?? 0
        );
      }
    })();
  } catch (error) {
    log.error({ err: error }, "Failed to save sessions to database");
  }
}
export function getOrCreateSession(chatId: string): SessionEntry {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  const row = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as
    | SessionRow
    | undefined;

  if (row) {
    return rowToSession(row);
  }

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

  log.info(`New session created: ${newSession.sessionId} for chat ${chatId}`);

  return newSession;
}
export function updateSession(
  chatId: string,
  update: Partial<Omit<SessionEntry, "chatId" | "createdAt">>
): SessionEntry {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  const existing = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as
    | SessionRow
    | undefined;

  if (!existing) {
    return getOrCreateSession(chatId);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

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
  if (update.inputTokens !== undefined) {
    updates.push("input_tokens = ?");
    values.push(update.inputTokens);
  }
  if (update.outputTokens !== undefined) {
    updates.push("output_tokens = ?");
    values.push(update.outputTokens);
  }

  updates.push("updated_at = ?");
  values.push(Date.now());

  values.push(sessionKey);

  db.prepare(
    `
    UPDATE sessions
    SET ${updates.join(", ")}
    WHERE chat_id = ?
  `
  ).run(...values);

  const updated = db
    .prepare("SELECT * FROM sessions WHERE chat_id = ?")
    .get(sessionKey) as SessionRow;
  return rowToSession(updated);
}
export function incrementMessageCount(chatId: string): void {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;

  const result = db
    .prepare(
      `UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE chat_id = ?`
    )
    .run(Date.now(), sessionKey);

  // If no row existed, create the session first then increment
  if (result.changes === 0) {
    getOrCreateSession(chatId);
    db.prepare(
      `UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE chat_id = ?`
    ).run(Date.now(), sessionKey);
  }
}
export function getSession(chatId: string): SessionEntry | null {
  const db = getDb();
  const sessionKey = `telegram:${chatId}`;
  const row = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as
    | SessionRow
    | undefined;

  return row ? rowToSession(row) : null;
}
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

  db.prepare(
    `
    UPDATE sessions
    SET id = ?, started_at = ?, updated_at = ?, message_count = 0
    WHERE chat_id = ?
  `
  ).run(newSession.sessionId, newSession.createdAt, newSession.updatedAt, sessionKey);

  log.info(`Session reset: ${oldSession?.sessionId} → ${newSession.sessionId}`);

  return newSession;
}
export function shouldResetSession(session: SessionEntry, policy: SessionResetPolicy): boolean {
  const now = Date.now();

  if (policy.daily_reset_enabled) {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const lastReset =
      session.lastResetDate || new Date(session.createdAt).toISOString().split("T")[0];

    if (lastReset !== today) {
      const currentHour = new Date().getHours();
      const resetHour = policy.daily_reset_hour;

      if (lastReset < today && currentHour >= resetHour) {
        log.info(
          `Daily reset triggered for session ${session.sessionId} (last reset: ${lastReset})`
        );
        return true;
      }
    }
  }

  if (policy.idle_expiry_enabled) {
    const idleMs = now - session.updatedAt;
    const idleMinutes = idleMs / (1000 * 60);
    const expiryMinutes = policy.idle_expiry_minutes;

    if (idleMinutes >= expiryMinutes) {
      log.info(
        `Idle expiry triggered for session ${session.sessionId} (idle: ${Math.floor(idleMinutes)}m)`
      );
      return true;
    }
  }

  return false;
}
export function resetSessionWithPolicy(chatId: string, policy: SessionResetPolicy): SessionEntry {
  const newSession = resetSession(chatId);
  const today = new Date().toISOString().split("T")[0];

  return updateSession(chatId, {
    lastResetDate: today,
  });
}
export function pruneOldSessions(maxAgeDays: number = 30): number {
  try {
    const db = getDb();
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    const result = db
      .prepare(`DELETE FROM sessions WHERE updated_at < ? AND updated_at > 0`)
      .run(cutoffMs);

    const pruned = result.changes;
    if (pruned > 0) {
      log.info(`🗑️ Pruned ${pruned} session(s) older than ${maxAgeDays} days`);
    }
    return pruned;
  } catch (error) {
    log.warn({ err: error }, "Failed to prune old sessions");
    return 0;
  }
}
