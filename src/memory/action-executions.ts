import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type { ToolResult } from "../agent/tools/types.js";

const volatileReceipts = new WeakMap<Database.Database, Map<string, ToolResult>>();
export function rememberActionReceipt(
  db: Database.Database,
  turnId: string,
  toolName: string,
  argsHash: string,
  result: ToolResult
): void {
  let receipts = volatileReceipts.get(db);
  if (!receipts) {
    receipts = new Map();
    volatileReceipts.set(db, receipts);
  }
  receipts.set(`${turnId}:${toolName}:${argsHash}`, result);
}

const ACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export type ActionExecutionResult = ToolResult;
export interface ActionExecution {
  operation_id: string;
  legacy_outcome: number;
  legacy_result_json: string | null;
  turn_id: string;
  tool_name: string;
  args_hash: string;
  status: "not_attempted" | "running" | "succeeded" | "failed" | "unknown";
  logical_session_key: string | null;
  chat_id: string | null;
  sender_id: number | null;
  requested_args_json: string | null;
  effective_args_json: string | null;
  result_json: string | null;
  remote_reference: string | null;
  persistence_error: string | null;
  revision: number;
  resolution_note: string | null;
  started_at: number;
  completed_at: number | null;
}

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
export function serializeActionValue(value: unknown): string {
  return (
    JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry
    ) ?? "null"
  );
}
export function hashActionArguments(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(args)) ?? "null")
    .digest("hex");
}
export type ActionReservation =
  | { kind: "execute"; argsHash: string; operationId: string }
  | { kind: "replay"; result: ActionExecutionResult }
  | { kind: "unknown"; operationId: string };

export function reserveActionExecution(
  db: Database.Database,
  turnId: string,
  toolName: string,
  args: unknown,
  metadata?: {
    logicalSessionKey?: string;
    requestedArgs?: unknown;
    chatId?: string;
    senderId?: number;
  }
): ActionReservation {
  return db.transaction(() => {
    const argsHash = hashActionArguments(args);
    const receipt = volatileReceipts.get(db)?.get(`${turnId}:${toolName}:${argsHash}`);
    if (receipt) return { kind: "replay" as const, result: receipt };
    const existing = db
      .prepare(
        `SELECT * FROM action_executions
      WHERE turn_id = ? AND tool_name = ? AND args_hash = ?`
      )
      .get(turnId, toolName, argsHash) as ActionExecution | undefined;
    if (existing) {
      if (existing.result_json && existing.status !== "running") {
        return {
          kind: "replay" as const,
          result: JSON.parse(existing.result_json) as ActionExecutionResult,
        };
      }
      return { kind: "unknown" as const, operationId: existing.operation_id };
    }
    if (metadata?.logicalSessionKey) {
      const unresolved = db
        .prepare(
          `SELECT operation_id FROM action_executions
        WHERE logical_session_key = ?
          AND status IN ('running', 'unknown') LIMIT 1`
        )
        .get(metadata.logicalSessionKey) as { operation_id: string } | undefined;
      if (unresolved) return { kind: "unknown" as const, operationId: unresolved.operation_id };
    }
    // Unresolved operations are retained until explicit reconciliation.
    db.prepare(
      "DELETE FROM action_executions WHERE started_at < ? AND status IN ('not_attempted', 'succeeded', 'failed')"
    ).run(Date.now() - ACTION_RETENTION_MS);
    const operationId = randomUUID();
    db.prepare(
      `INSERT INTO action_executions
      (turn_id, tool_name, args_hash, status, started_at, operation_id, logical_session_key,
       chat_id, sender_id, requested_args_json, effective_args_json)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      turnId,
      toolName,
      argsHash,
      Date.now(),
      operationId,
      metadata?.logicalSessionKey ?? null,
      metadata?.chatId ?? null,
      metadata?.senderId ?? null,
      serializeActionValue(metadata?.requestedArgs ?? args),
      serializeActionValue(args)
    );
    return { kind: "execute" as const, argsHash, operationId };
  })();
}
export function completeActionExecution(
  db: Database.Database,
  turnId: string,
  toolName: string,
  argsHash: string,
  result: ActionExecutionResult
): void {
  const outcome = result.execution?.outcome ?? (result.success ? "succeeded" : "unknown");
  const persisted = db
    .prepare(
      `UPDATE action_executions SET status = ?, result_json = ?, completed_at = ?,
      remote_reference = ?, persistence_error = ?, revision = revision + 1
    WHERE turn_id = ? AND tool_name = ? AND args_hash = ? AND status = 'running'`
    )
    .run(
      ["not_attempted", "succeeded", "failed"].includes(outcome) ? outcome : "unknown",
      serializeActionValue(result),
      Date.now(),
      result.execution?.remoteReference ?? null,
      result.execution?.error ?? null,
      turnId,
      toolName,
      argsHash
    );
  if (persisted.changes !== 1) throw new Error("Action receipt compare-and-set failed");
}
export function listActionExecutions(db: Database.Database, status?: string): ActionExecution[] {
  return db
    .prepare(
      `SELECT * FROM action_executions ${status ? "WHERE status = ?" : ""}
    ORDER BY started_at DESC LIMIT 500`
    )
    .all(...(status ? [status] : [])) as ActionExecution[];
}
export function resolveActionExecution(
  db: Database.Database,
  operationId: string,
  revision: number,
  outcome: "succeeded" | "failed",
  note: string,
  remoteReference?: string
): boolean {
  const result: ToolResult = {
    success: outcome === "succeeded",
    execution: {
      outcome,
      operationId,
      persistence: "persisted",
      remoteReference,
    },
    data: { resolution: note },
  };
  return (
    db
      .prepare(
        `UPDATE action_executions SET status = ?, revision = revision + 1,
    resolution_note = ?, remote_reference = ?, result_json = ?, completed_at = ?
    WHERE operation_id = ? AND revision = ? AND status = 'unknown'`
      )
      .run(
        outcome,
        note,
        remoteReference ?? null,
        serializeActionValue(result),
        Date.now(),
        operationId,
        revision
      ).changes === 1
  );
}

/** A process restart cannot prove whether an invocation reached the remote service. */
export function recoverActionExecutions(db: Database.Database): number {
  return db
    .prepare(
      `UPDATE action_executions SET status = 'unknown', revision = revision + 1,
    persistence_error = COALESCE(persistence_error, 'Process stopped before receipt persistence')
    WHERE status = 'running'`
    )
    .run().changes;
}
