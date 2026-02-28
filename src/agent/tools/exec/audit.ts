import type Database from "better-sqlite3";
import type { ExecAuditEntry } from "./types.js";

export function insertAuditEntry(db: Database.Database, entry: ExecAuditEntry): number {
  const result = db
    .prepare(
      `INSERT INTO exec_audit (user_id, username, tool, command, status, exit_code, signal, duration_ms, stdout, stderr, truncated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.userId,
      entry.username ?? null,
      entry.tool,
      entry.command,
      entry.status,
      entry.exitCode ?? null,
      entry.signal ?? null,
      entry.duration ?? null,
      entry.stdout ?? null,
      entry.stderr ?? null,
      entry.truncated ? 1 : 0
    );
  return Number(result.lastInsertRowid);
}

export function updateAuditEntry(
  db: Database.Database,
  id: number,
  update: Partial<
    Pick<
      ExecAuditEntry,
      "status" | "exitCode" | "signal" | "duration" | "stdout" | "stderr" | "truncated"
    >
  >
): void {
  db.prepare(
    `UPDATE exec_audit
     SET status = COALESCE(?, status),
         exit_code = COALESCE(?, exit_code),
         signal = COALESCE(?, signal),
         duration_ms = COALESCE(?, duration_ms),
         stdout = COALESCE(?, stdout),
         stderr = COALESCE(?, stderr),
         truncated = COALESCE(?, truncated)
     WHERE id = ?`
  ).run(
    update.status ?? null,
    update.exitCode ?? null,
    update.signal ?? null,
    update.duration ?? null,
    update.stdout ?? null,
    update.stderr ?? null,
    update.truncated !== undefined ? (update.truncated ? 1 : 0) : null,
    id
  );
}
