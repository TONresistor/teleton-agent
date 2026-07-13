import type Database from "better-sqlite3";
import {
  failAgentTurnTrace,
  finishAgentTurnTrace,
  startAgentTurnTrace,
  updateAgentTurnTraceProgress,
  updateAgentTurnTraceTarget,
  type AgentTurnTraceStatus,
  type AgentTurnTraceTool,
} from "../memory/agent-traces.js";
import { createLogger } from "../utils/logger.js";
import type { UsageAccumulator } from "./runtime-utils.js";
import type { CompletedToolCall } from "./telegram-send-state.js";

const log = createLogger("AgentTrace");

function toTraceTools(calls: CompletedToolCall[]): AgentTurnTraceTool[] {
  return calls
    .filter((call) => call.attempted !== false)
    .map((call) => ({
      name: call.name,
      success: call.result?.success ?? false,
      durationMs: call.durationMs ?? 0,
    }));
}

export class AgentTurnTraceRecorder {
  private started = false;
  private finished = false;

  constructor(
    private readonly db: Database.Database,
    private readonly turnId: string
  ) {}

  start(input: {
    sessionId: string;
    chatId: string;
    startedAt: number;
    provider: string;
    model: string;
    requestedModel: string;
    endpointFingerprint: string;
    selectedTools: string[];
  }): void {
    try {
      startAgentTurnTrace(this.db, { id: this.turnId, ...input });
      this.started = true;
    } catch (error) {
      log.warn({ err: error }, "Unable to persist agent turn trace start");
    }
  }

  progress(calls: CompletedToolCall[], iterations: number, usage: UsageAccumulator): void {
    if (!this.started || this.finished) return;
    try {
      updateAgentTurnTraceProgress(this.db, this.turnId, {
        tools: toTraceTools(calls),
        iterations,
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalCost: usage.totalCost,
      });
    } catch (error) {
      log.warn({ err: error }, "Unable to persist agent turn trace progress");
    }
  }

  updateTarget(provider: string, model: string, endpointFingerprint: string): void {
    if (!this.started || this.finished) return;
    try {
      updateAgentTurnTraceTarget(this.db, this.turnId, { provider, model, endpointFingerprint });
    } catch (error) {
      log.warn({ err: error }, "Unable to update agent turn trace target");
    }
  }

  finish(input: {
    status: Exclude<AgentTurnTraceStatus, "running">;
    calls: CompletedToolCall[];
    iterations: number;
    usage: UsageAccumulator;
    stopReason: string;
    provider: string;
    model: string;
    errorMessage?: string;
  }): void {
    if (!this.started || this.finished) return;
    try {
      finishAgentTurnTrace(this.db, this.turnId, {
        completedAt: Date.now(),
        status: input.status,
        tools: toTraceTools(input.calls),
        iterations: input.iterations,
        inputTokens: input.usage.input,
        outputTokens: input.usage.output,
        totalCost: input.usage.totalCost,
        stopReason: input.stopReason,
        provider: input.provider,
        model: input.model,
        errorMessage: input.errorMessage,
      });
      this.finished = true;
    } catch (error) {
      log.warn({ err: error }, "Unable to finish agent turn trace");
    }
  }

  fail(error: unknown): void {
    if (!this.started || this.finished) return;
    try {
      failAgentTurnTrace(
        this.db,
        this.turnId,
        error instanceof Error ? error.message : String(error)
      );
      this.finished = true;
    } catch (traceError) {
      log.warn({ err: traceError }, "Unable to finish failed agent turn trace");
    }
  }
}
