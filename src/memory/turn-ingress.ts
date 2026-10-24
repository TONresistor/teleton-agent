import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TelegramMessage } from "../telegram/bridge-interface.js";
import type { AgentResponse } from "../agent/turn-types.js";

export const TURN_INGRESS_DDL = `CREATE TABLE IF NOT EXISTS turn_ingress (
  ingress_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, turn_id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL, message_id INTEGER, sender_id INTEGER, received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', response_json TEXT, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS idx_turn_ingress_chat ON turn_ingress(chat_id, message_id);
CREATE TABLE IF NOT EXISTS telegram_ingress_events (
 ingress_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, hooks_claimed_at INTEGER NOT NULL
);`;
export interface TurnIngress {
  ingress_key: string;
  request_hash: string;
  turn_id: string;
  chat_id: string;
  message_id: number | null;
  sender_id: number | null;
  received_at: number;
  status: "running" | "generated" | "unknown";
  response_json: string | null;
  updated_at: number;
}
export function getTurnIngress(db: Database.Database, key: string): TurnIngress | undefined {
  return db.prepare("SELECT * FROM turn_ingress WHERE ingress_key = ?").get(key) as
    TurnIngress | undefined;
}
export function hashIngressRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** Hash only stable, raw event fields; preprocessing output is deliberately excluded. */
export function hashTelegramIngress(message: TelegramMessage): string {
  return hashIngressRequest([
    message.chatId,
    message.id,
    message.senderId,
    message.text,
    message.hasMedia,
    message.mediaType ?? null,
    message.mediaIdentity ?? null,
    message.replyToId ?? null,
    message.isGroup,
    message.isChannel,
  ]);
}
/** Durable at-most-once plugin notification, including inputs that do not start a turn. */
export function claimTelegramIngressHooks(
  db: Database.Database,
  key: string,
  hash: string
): boolean {
  return (
    db
      .prepare(
        "INSERT INTO telegram_ingress_events(ingress_key,request_hash,hooks_claimed_at) VALUES (?,?,?) ON CONFLICT(ingress_key) DO NOTHING"
      )
      .run(key, hash, Date.now()).changes === 1
  );
}
export function reserveTurnIngress(
  db: Database.Database,
  request: {
    key: string;
    hash?: string;
    chatId: string;
    messageId?: number;
    senderId?: number;
    text: string;
    receivedAt?: number;
    turnId?: string;
  }
): { kind: "generate" | "resume" | "busy" | "conflict"; turnId: string; response?: AgentResponse } {
  return db.transaction(() => {
    const hash =
      request.hash ??
      hashIngressRequest([request.chatId, request.messageId, request.senderId, request.text]);
    const existing = getTurnIngress(db, request.key);
    if (existing) {
      if (existing.request_hash !== hash)
        return { kind: "conflict" as const, turnId: existing.turn_id };
      if (existing.response_json)
        return {
          kind: "resume" as const,
          turnId: existing.turn_id,
          response: JSON.parse(existing.response_json) as AgentResponse,
        };
      return { kind: "busy" as const, turnId: existing.turn_id };
    }
    const turnId = request.turnId ?? randomUUID();
    db.prepare(
      `INSERT INTO turn_ingress (ingress_key,request_hash,turn_id,chat_id,message_id,sender_id,received_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      request.key,
      hash,
      turnId,
      request.chatId,
      request.messageId ?? null,
      request.senderId ?? null,
      request.receivedAt ?? Date.now(),
      Date.now()
    );
    return { kind: "generate" as const, turnId };
  })();
}
/** Must succeed before any final response is sent. */
export function completeTurnIngress(
  db: Database.Database,
  key: string,
  response: AgentResponse
): void {
  const result = db
    .prepare(
      "UPDATE turn_ingress SET status='generated', response_json=?, updated_at=? WHERE ingress_key=?"
    )
    .run(JSON.stringify(response), Date.now(), key);
  if (result.changes !== 1)
    throw new Error("Ingress reservation disappeared before response persistence");
}
export function recoverTurnIngress(db: Database.Database): void {
  db.prepare("UPDATE turn_ingress SET status='unknown', updated_at=? WHERE status='running'").run(
    Date.now()
  );
}
