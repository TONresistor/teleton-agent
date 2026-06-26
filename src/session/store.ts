import { randomUUID } from "crypto";
import type { SessionResetPolicy } from "../config/schema.js";
import { getDatabase } from "../memory/index.js";
import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Session");

/** Build the DB session key for a chat. Centralised so the prefix can't drift. */
function sessionKeyFor(chatId: string): string {
  return `telegram:${chatId}`;
}

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

/**
 * camelCase field → snake_case column for the fields updateSession can write.
 * `updated_at` is always set separately; `chatId`/`createdAt` are immutable.
 * Single source for the dynamic UPDATE so the SET clause can't drift from the
 * field list. rowToSession keeps its own (non-mechanical) coercions.
 */
const SESSION_UPDATE_COLUMNS: Record<
  keyof Omit<SessionEntry, "chatId" | "createdAt" | "updatedAt">,
  string
> = {
  sessionId: "id",
  messageCount: "message_count",
  lastMessageId: "last_message_id",
  lastChannel: "last_channel",
  lastTo: "last_to",
  contextTokens: "context_tokens",
  model: "model",
  provider: "provider",
  lastResetDate: "last_reset_date",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
};

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
export function getOrCreateSession(chatId: string): SessionEntry {
  const db = getDb();
  const sessionKey = sessionKeyFor(chatId);

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
  const sessionKey = sessionKeyFor(chatId);

  const existing = db.prepare("SELECT * FROM sessions WHERE chat_id = ?").get(sessionKey) as
    | SessionRow
    | undefined;

  if (!existing) {
    return getOrCreateSession(chatId);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(SESSION_UPDATE_COLUMNS) as [
    keyof typeof SESSION_UPDATE_COLUMNS,
    string,
  ][]) {
    const value = update[field];
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      values.push(value);
    }
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
export function getSession(chatId: string): SessionEntry | null {
  const db = getDb();
  const sessionKey = sessionKeyFor(chatId);
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
  const sessionKey = sessionKeyFor(chatId);

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
      const currentHour = new Date().getUTCHours();
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
export function resetSessionWithPolicy(chatId: string): SessionEntry {
  resetSession(chatId);
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
      log.info(`Pruned ${pruned} session(s) older than ${maxAgeDays} days`);
    }
    return pruned;
  } catch (error) {
    log.warn({ err: error }, "Failed to prune old sessions");
    return 0;
  }
}
