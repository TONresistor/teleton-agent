import { createHash } from "crypto";
import type Database from "better-sqlite3";

const ACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type ActionExecutionResult = { success: boolean; data?: unknown; error?: string };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return typeof value === "bigint" ? value.toString() : value;
}

export function hashActionArguments(args: unknown): string {
  const serialized = JSON.stringify(canonicalize(args)) ?? "null";
  return createHash("sha256").update(serialized).digest("hex");
}

export type ActionReservation =
  | { kind: "execute"; argsHash: string }
  | { kind: "replay"; result: ActionExecutionResult }
  | { kind: "unknown" };

export function reserveActionExecution(
  db: Database.Database,
  turnId: string,
  toolName: string,
  args: unknown
): ActionReservation {
  const argsHash = hashActionArguments(args);
  const now = Date.now();
  db.prepare("DELETE FROM action_executions WHERE started_at < ?").run(now - ACTION_RETENTION_MS);
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO action_executions
         (turn_id, tool_name, args_hash, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`
    )
    .run(turnId, toolName, argsHash, now);
  if (inserted.changes === 1) return { kind: "execute", argsHash };

  const existing = db
    .prepare(
      `SELECT status, result_json AS resultJson FROM action_executions
       WHERE turn_id = ? AND tool_name = ? AND args_hash = ?`
    )
    .get(turnId, toolName, argsHash) as { status: string; resultJson: string | null } | undefined;
  if (existing?.resultJson && (existing.status === "succeeded" || existing.status === "failed")) {
    return { kind: "replay", result: JSON.parse(existing.resultJson) as ActionExecutionResult };
  }
  return { kind: "unknown" };
}

export function completeActionExecution(
  db: Database.Database,
  turnId: string,
  toolName: string,
  argsHash: string,
  result: ActionExecutionResult
): void {
  db.prepare(
    `UPDATE action_executions SET status = ?, result_json = ?, completed_at = ?
     WHERE turn_id = ? AND tool_name = ? AND args_hash = ?`
  ).run(
    result.success ? "succeeded" : "failed",
    JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    Date.now(),
    turnId,
    toolName,
    argsHash
  );
}
