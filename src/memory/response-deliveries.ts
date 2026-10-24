import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export const RESPONSE_DELIVERIES_DDL = `CREATE TABLE IF NOT EXISTS response_deliveries (
 delivery_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, chat_id TEXT NOT NULL, target_kind TEXT NOT NULL,
 payload_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'prepared', revision INTEGER NOT NULL DEFAULT 0, reason TEXT,
 resolution_note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(turn_id,chat_id,target_kind)
); CREATE TABLE IF NOT EXISTS response_delivery_fragments (
 delivery_id TEXT NOT NULL REFERENCES response_deliveries(delivery_id), fragment_index INTEGER NOT NULL,
 text TEXT NOT NULL, entities_json TEXT, attempt_token TEXT, status TEXT NOT NULL DEFAULT 'prepared',
 message_id INTEGER, sent_at INTEGER, error TEXT, feed_recorded INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(delivery_id,fragment_index)
); CREATE TABLE IF NOT EXISTS response_delivery_attempts (
 attempt_token TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES response_deliveries(delivery_id),
 fragment_index INTEGER NOT NULL, status TEXT NOT NULL, message_id INTEGER, error TEXT,
 created_at INTEGER NOT NULL, completed_at INTEGER
);`;
export interface ResponseDelivery {
  delivery_id: string;
  turn_id: string;
  chat_id: string;
  target_kind: string;
  payload_hash: string;
  status: "prepared" | "sending" | "delivered" | "partial" | "failed" | "unknown";
  revision: number;
  reason: string | null;
  resolution_note: string | null;
  created_at: number;
  updated_at: number;
}
export interface DeliveryFragment {
  delivery_id: string;
  fragment_index: number;
  text: string;
  entities_json: string | null;
  attempt_token: string | null;
  status: "prepared" | "sending" | "delivered" | "failed" | "unknown";
  message_id: number | null;
  sent_at: number | null;
  error: string | null;
  feed_recorded: number;
}
export function getResponseDelivery(
  db: Database.Database,
  id: string
): ResponseDelivery | undefined {
  return db.prepare("SELECT * FROM response_deliveries WHERE delivery_id=?").get(id) as
    ResponseDelivery | undefined;
}
export function listResponseDeliveries(db: Database.Database, status?: string): ResponseDelivery[] {
  return db
    .prepare(
      `SELECT * FROM response_deliveries ${status ? "WHERE status=?" : ""} ORDER BY created_at DESC LIMIT 500`
    )
    .all(...(status ? [status] : [])) as ResponseDelivery[];
}
export function listDeliveryFragments(db: Database.Database, id: string): DeliveryFragment[] {
  return db
    .prepare(
      "SELECT * FROM response_delivery_fragments WHERE delivery_id=? ORDER BY fragment_index"
    )
    .all(id) as DeliveryFragment[];
}
export function prepareResponseDelivery(
  db: Database.Database,
  turnId: string,
  chatId: string,
  targetKind: string,
  fragments: Array<{ text: string; entities?: unknown[] }>
): ResponseDelivery {
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM response_deliveries WHERE turn_id=? AND chat_id=? AND target_kind=?")
      .get(turnId, chatId, targetKind) as ResponseDelivery | undefined;
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(fragments.map((fragment) => [fragment.text, fragment.entities ?? []])))
      .digest("hex");
    if (existing) {
      if (existing.payload_hash !== payloadHash)
        throw new Error("Delivery payload conflicts with its persisted response");
      return existing;
    }
    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO response_deliveries(delivery_id,turn_id,chat_id,target_kind,payload_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, turnId, chatId, targetKind, payloadHash, now, now);
    const insert = db.prepare(
      "INSERT INTO response_delivery_fragments(delivery_id,fragment_index,text,entities_json) VALUES (?,?,?,?)"
    );
    fragments.forEach((fragment, index) =>
      insert.run(
        id,
        index,
        fragment.text,
        fragment.entities ? JSON.stringify(fragment.entities) : null
      )
    );
    const created = getResponseDelivery(db, id);
    if (!created) throw new Error("Delivery reservation disappeared");
    return created;
  })();
}
export function claimDeliveryFragment(
  db: Database.Database,
  id: string,
  index: number,
  token: string = randomUUID()
): boolean {
  return db.transaction(() => {
    const changed = db
      .prepare(
        "UPDATE response_delivery_fragments SET status='sending',attempt_token=? WHERE delivery_id=? AND fragment_index=? AND status='prepared'"
      )
      .run(token, id, index).changes;
    if (!changed) return false;
    db.prepare(
      "INSERT INTO response_delivery_attempts(attempt_token,delivery_id,fragment_index,status,created_at) VALUES (?,?,?,'sending',?)"
    ).run(token, id, index, Date.now());
    return true;
  })();
}
function updateAttempt(
  db: Database.Database,
  id: string,
  index: number,
  status: string,
  messageId?: number,
  error?: string
): void {
  try {
    db.prepare(
      "UPDATE response_delivery_attempts SET status=?,message_id=COALESCE(?,message_id),error=?,completed_at=? WHERE attempt_token=(SELECT attempt_token FROM response_delivery_fragments WHERE delivery_id=? AND fragment_index=?)"
    ).run(status, messageId ?? null, error ?? null, Date.now(), id, index);
  } catch {
    /* Fragment receipts remain authoritative when the attempt projection fails. */
  }
}
export function listDeliveryAttempts(
  db: Database.Database,
  id: string
): Array<Record<string, unknown>> {
  return db
    .prepare(
      "SELECT * FROM response_delivery_attempts WHERE delivery_id=? ORDER BY created_at,attempt_token"
    )
    .all(id) as Array<Record<string, unknown>>;
}
export function confirmDeliveryFragment(
  db: Database.Database,
  id: string,
  index: number,
  messageId: number,
  date: number,
  attemptToken?: string
): void {
  const result = db
    .prepare(
      "UPDATE response_delivery_fragments SET status='delivered',message_id=?,sent_at=? WHERE delivery_id=? AND fragment_index=? AND status='sending' AND (? IS NULL OR attempt_token=?)"
    )
    .run(messageId, date, id, index, attemptToken ?? null, attemptToken ?? null);
  if (result.changes !== 1) throw new Error("Delivery receipt compare-and-set failed");
  updateAttempt(db, id, index, "delivered", messageId);
}
export function confirmLateDeliveryFragment(
  db: Database.Database,
  id: string,
  index: number,
  token: string,
  messageId: number,
  date: number
): boolean {
  const changed =
    db
      .prepare(
        "UPDATE response_delivery_fragments SET status='delivered',message_id=?,sent_at=?,error=NULL WHERE delivery_id=? AND fragment_index=? AND status='unknown' AND attempt_token=?"
      )
      .run(messageId, date, id, index, token).changes === 1;
  if (changed) updateAttempt(db, id, index, "delivered", messageId);
  return changed;
}
export function markDeliveryFragment(
  db: Database.Database,
  id: string,
  index: number,
  status: "failed" | "unknown",
  error: string
): void {
  db.prepare(
    "UPDATE response_delivery_fragments SET status=?,error=? WHERE delivery_id=? AND fragment_index=? AND status='sending'"
  ).run(status, error, id, index);
  updateAttempt(db, id, index, status, undefined, error);
}
export function updateResponseDelivery(
  db: Database.Database,
  id: string,
  status: ResponseDelivery["status"],
  reason?: string
): void {
  db.prepare(
    "UPDATE response_deliveries SET status=?,reason=?,revision=revision+1,updated_at=? WHERE delivery_id=?"
  ).run(status, reason ?? null, Date.now(), id);
}
export function recoverResponseDeliveries(db: Database.Database): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE response_delivery_attempts SET status='unknown',error='Process stopped during send',completed_at=? WHERE status='sending'"
    ).run(Date.now());
    db.prepare(
      "UPDATE response_delivery_fragments SET status='unknown',error='Process stopped during send' WHERE status='sending'"
    ).run();
    db.prepare(
      "UPDATE response_deliveries SET status='unknown',revision=revision+1,reason='Process stopped during send',updated_at=? WHERE status='sending'"
    ).run(Date.now());
  })();
}
const activeAttempts = new WeakMap<Database.Database, Map<string, Set<string>>>();
export function trackActiveDeliveryAttempt(
  db: Database.Database,
  id: string,
  token: string,
  promise: Promise<unknown>
): void {
  let deliveries = activeAttempts.get(db);
  if (!deliveries) {
    deliveries = new Map();
    activeAttempts.set(db, deliveries);
  }
  let attempts = deliveries.get(id);
  if (!attempts) {
    attempts = new Set();
    deliveries.set(id, attempts);
  }
  attempts.add(token);
  const release = () => {
    attempts.delete(token);
    if (!attempts.size) deliveries.delete(id);
  };
  void promise.then(release, release);
}
/** Explicit operator reconciliation. Only an evidenced non-delivery permits a retry. */
export function resolveResponseDelivery(
  db: Database.Database,
  id: string,
  revision: number,
  outcome: "delivered" | "not_delivered",
  note: string,
  messageId?: number
): boolean {
  if (activeAttempts.get(db)?.get(id)?.size) return false;
  return db.transaction(() => {
    const changed = db
      .prepare(
        "UPDATE response_deliveries SET status=?,resolution_note=?,revision=revision+1,updated_at=? WHERE delivery_id=? AND revision=? AND status='unknown'"
      )
      .run(
        outcome === "delivered" ? "delivered" : "prepared",
        note,
        Date.now(),
        id,
        revision
      ).changes;
    if (!changed) return false;
    db.prepare(
      "UPDATE response_delivery_attempts SET status=?,message_id=COALESCE(?,message_id),error=?,completed_at=? WHERE attempt_token IN (SELECT attempt_token FROM response_delivery_fragments WHERE delivery_id=? AND status IN ('unknown','sending'))"
    ).run(outcome, messageId ?? null, note, Date.now(), id);
    db.prepare(
      "UPDATE response_delivery_fragments SET status=?,message_id=COALESCE(?,message_id),error=NULL WHERE delivery_id=? AND status IN ('unknown','sending')"
    ).run(outcome === "delivered" ? "delivered" : "prepared", messageId ?? null, id);
    if (
      outcome === "delivered" &&
      listDeliveryFragments(db, id).some((fragment) => fragment.status !== "delivered")
    ) {
      db.prepare("UPDATE response_deliveries SET status='prepared' WHERE delivery_id=?").run(id);
    }
    return true;
  })();
}

/** Explicit known-failure retry; never changes confirmed chunks or unresolved attempts. */
export function prepareDeliveryRetry(
  db: Database.Database,
  id: string,
  revision: number,
  note: string
): boolean {
  if (activeAttempts.get(db)?.get(id)?.size) return false;
  return db.transaction(() => {
    if (
      listDeliveryFragments(db, id).some(
        (fragment) => fragment.status === "unknown" || fragment.status === "sending"
      )
    )
      return false;
    const changed = db
      .prepare(
        "UPDATE response_deliveries SET status='prepared',resolution_note=COALESCE(resolution_note||char(10),'')||?,revision=revision+1,updated_at=? WHERE delivery_id=? AND revision=? AND status IN ('prepared','failed','partial')"
      )
      .run(`Retry: ${note}`, Date.now(), id, revision).changes;
    if (!changed) return false;
    db.prepare(
      "UPDATE response_delivery_fragments SET status='prepared',error=NULL WHERE delivery_id=? AND status='failed'"
    ).run(id);
    return true;
  })();
}
