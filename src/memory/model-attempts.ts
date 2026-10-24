import type Database from "better-sqlite3";
import type { ModelAttemptUsage } from "../agent/attempt-usage.js";

export const DDL_MODEL_ATTEMPTS = `
  CREATE TABLE IF NOT EXISTS model_attempts (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    stop_reason TEXT,
    usage_json TEXT,
    incomplete INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_model_attempts_turn ON model_attempts(turn_id);
`;

export function persistModelAttempts(
  db: Database.Database,
  turnId: string,
  attempts: ModelAttemptUsage[]
): void {
  const write = db.prepare(`INSERT INTO model_attempts
    (id, turn_id, provider, model, purpose, started_at, completed_at, duration_ms,
     stop_reason, usage_json, incomplete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,
      duration_ms=excluded.duration_ms, stop_reason=excluded.stop_reason,
      usage_json=excluded.usage_json, incomplete=excluded.incomplete`);
  db.transaction(() => {
    for (const attempt of attempts) {
      write.run(
        attempt.attemptId,
        turnId,
        attempt.provider,
        attempt.model,
        attempt.purpose,
        attempt.startedAt,
        attempt.completedAt,
        attempt.durationMs,
        attempt.stopReason ?? null,
        attempt.usage ? JSON.stringify(attempt.usage) : null,
        attempt.incomplete ? 1 : 0
      );
    }
  })();
}
