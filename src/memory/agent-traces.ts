import type Database from "better-sqlite3";

const TRACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type AgentTurnTraceStatus = "running" | "completed" | "error" | "budget_exhausted";

export interface AgentTurnTraceTool {
  name: string;
  success: boolean;
  durationMs: number;
}

export interface StartAgentTurnTrace {
  id: string;
  sessionId: string;
  chatId: string;
  startedAt: number;
  provider: string;
  model: string;
  requestedModel: string;
  endpointFingerprint: string;
  selectedTools: string[];
}

export interface FinishAgentTurnTrace {
  completedAt: number;
  status: Exclude<AgentTurnTraceStatus, "running">;
  tools: AgentTurnTraceTool[];
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  stopReason: string;
  provider?: string;
  model?: string;
  errorMessage?: string;
}

export function startAgentTurnTrace(db: Database.Database, trace: StartAgentTurnTrace): void {
  db.prepare(
    `INSERT INTO agent_turn_traces (
       id, session_id, chat_id, started_at, status, provider, model,
       requested_model, endpoint_fingerprint, selected_tools_json
     ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`
  ).run(
    trace.id,
    trace.sessionId,
    trace.chatId,
    trace.startedAt,
    trace.provider,
    trace.model,
    trace.requestedModel,
    trace.endpointFingerprint,
    JSON.stringify(trace.selectedTools)
  );
  db.prepare("DELETE FROM agent_turn_traces WHERE started_at < ?").run(
    trace.startedAt - TRACE_RETENTION_MS
  );
}

export function finishAgentTurnTrace(
  db: Database.Database,
  traceId: string,
  result: FinishAgentTurnTrace
): void {
  db.prepare(
    `UPDATE agent_turn_traces SET
       completed_at = ?, status = ?, tools_json = ?, iterations = ?, tool_calls = ?,
       input_tokens = ?, output_tokens = ?, total_cost = ?, stop_reason = ?, error_message = ?,
       provider = COALESCE(?, provider), model = COALESCE(?, model)
     WHERE id = ?`
  ).run(
    result.completedAt,
    result.status,
    JSON.stringify(result.tools),
    result.iterations,
    result.tools.length,
    result.inputTokens,
    result.outputTokens,
    result.totalCost,
    result.stopReason,
    result.errorMessage?.slice(0, 2_000) ?? null,
    result.provider ?? null,
    result.model ?? null,
    traceId
  );
}

export function updateAgentTurnTraceProgress(
  db: Database.Database,
  traceId: string,
  progress: {
    tools: AgentTurnTraceTool[];
    iterations: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  }
): void {
  db.prepare(
    `UPDATE agent_turn_traces SET tools_json = ?, tool_calls = ?, iterations = ?,
       input_tokens = ?, output_tokens = ?, total_cost = ?
     WHERE id = ? AND status = 'running'`
  ).run(
    JSON.stringify(progress.tools),
    progress.tools.length,
    progress.iterations,
    progress.inputTokens,
    progress.outputTokens,
    progress.totalCost,
    traceId
  );
}

export function updateAgentTurnTraceTarget(
  db: Database.Database,
  traceId: string,
  target: { provider: string; model: string; endpointFingerprint: string }
): void {
  db.prepare(
    `UPDATE agent_turn_traces
     SET provider = ?, model = ?, endpoint_fingerprint = ?
     WHERE id = ? AND status = 'running'`
  ).run(target.provider, target.model, target.endpointFingerprint, traceId);
}

export function failAgentTurnTrace(
  db: Database.Database,
  traceId: string,
  errorMessage: string
): void {
  db.prepare(
    `UPDATE agent_turn_traces SET completed_at = ?, status = ?, stop_reason = ?, error_message = ?
     WHERE id = ?`
  ).run(Date.now(), "error", "error", errorMessage.slice(0, 2_000), traceId);
}
