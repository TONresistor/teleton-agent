import type { Message, Tool as PiAiTool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { MAX_TOOL_RESULT_SIZE, TOOL_CONCURRENCY_LIMIT } from "../../constants/limits.js";
import type { createHookRunner } from "../../sdk/hooks/runner.js";
import type {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  ToolErrorEvent,
} from "../../sdk/hooks/types.js";
import { appendToTranscript } from "../../session/transcript.js";
import { createToolResultArtifact } from "../../memory/tool-result-artifacts.js";
import { getErrorMessage } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import type { CompletedToolCall } from "../telegram-send-state.js";
import { summarizeToolParams } from "../runtime-utils.js";
import {
  attachArtifactReference,
  serializeToolResult,
  truncateToolResult,
} from "../tool-result-truncator.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export interface ToolPlan {
  block: ToolCall;
  blocked: boolean;
  blockReason: string;
  params: Record<string, unknown>;
}

export interface ToolExecResult {
  result: { success: boolean; data?: unknown; error?: string };
  durationMs: number;
  attempted?: boolean;
  execError?: { message: string; stack?: string };
}

/**
 * Phases 1-2 of a tool batch: run tool:before hooks sequentially to build the plans,
 * then execute the (non-blocked) tools with a bounded concurrency pool. Returns the
 * plans and their results in original order.
 */
export async function executeToolBatch(
  toolRegistry: ToolRegistry,
  hookRunner: HookRunner | undefined,
  toolCalls: ToolCall[],
  fullContext: ToolContext,
  chatId: string,
  effectiveIsGroup: boolean
): Promise<{ toolPlans: ToolPlan[]; execResults: ToolExecResult[] }> {
  // Phase 1: Run tool:before hooks sequentially (hooks may cross-reference)
  const toolPlans: ToolPlan[] = [];

  for (const block of toolCalls) {
    if (block.type !== "toolCall") continue;

    let toolParams = (block.arguments ?? {}) as Record<string, unknown>;
    let blocked = false;
    let blockReason = "";

    if (hookRunner) {
      const beforeEvent: BeforeToolCallEvent = {
        toolName: block.name,
        params: structuredClone(toolParams),
        chatId,
        isGroup: effectiveIsGroup,
        block: false,
        blockReason: "",
      };
      await hookRunner.runModifyingHook("tool:before", beforeEvent);
      if (beforeEvent.block) {
        blocked = true;
        blockReason = beforeEvent.blockReason || "Blocked by plugin hook";
      } else {
        toolParams = structuredClone(beforeEvent.params) as Record<string, unknown>;
      }
    }

    toolPlans.push({ block, blocked, blockReason, params: toolParams });
  }

  // Phase 2: preserve model order for actions; parallelize only contiguous reads.
  const execResults: ToolExecResult[] = new Array(toolPlans.length);
  const runPlan = async (idx: number): Promise<void> => {
    const plan = toolPlans[idx];
    if (plan.blocked) {
      execResults[idx] = {
        result: { success: false, error: plan.blockReason },
        durationMs: 0,
        attempted: false,
      };
      return;
    }

    const startTime = Date.now();
    try {
      const result = await toolRegistry.execute(
        { ...plan.block, arguments: plan.params },
        fullContext
      );
      execResults[idx] = { result, durationMs: Date.now() - startTime, attempted: true };
    } catch (execErr) {
      const errMsg = getErrorMessage(execErr);
      const errStack = execErr instanceof Error ? execErr.stack : undefined;
      execResults[idx] = {
        result: { success: false, error: errMsg },
        durationMs: Date.now() - startTime,
        attempted: true,
        execError: { message: errMsg, stack: errStack },
      };
    }
  };

  let cursor = 0;
  while (cursor < toolPlans.length) {
    const plan = toolPlans[cursor];
    const isRead =
      !plan.blocked && toolRegistry.getToolCategory(plan.block.name) === "data-bearing";
    if (!isRead) {
      await runPlan(cursor++);
      continue;
    }

    const readIndexes: number[] = [];
    while (
      cursor < toolPlans.length &&
      !toolPlans[cursor].blocked &&
      toolRegistry.getToolCategory(toolPlans[cursor].block.name) === "data-bearing"
    ) {
      readIndexes.push(cursor++);
    }

    let readCursor = 0;
    const runReadWorker = async (): Promise<void> => {
      while (readCursor < readIndexes.length) {
        await runPlan(readIndexes[readCursor++]);
      }
    };
    const workers = Math.min(TOOL_CONCURRENCY_LIMIT, readIndexes.length);
    await Promise.all(Array.from({ length: workers }, () => runReadWorker()));
  }

  return { toolPlans, execResults };
}

/**
 * Phase 3 of a tool batch: fire tool:error/tool:after observing hooks, log + record
 * each call, and build the tool-result messages (appending them to the transcript).
 * Mutates the passed `totalToolCalls`/`iterationToolNames` sinks and returns the
 * ordered result messages for the caller to push onto the live context.
 */
export async function recordToolResults(
  hookRunner: HookRunner | undefined,
  toolPlans: ToolPlan[],
  execResults: ToolExecResult[],
  sink: {
    totalToolCalls: CompletedToolCall[];
    iterationToolNames: string[];
    sessionId: string;
    chatId: string;
    effectiveIsGroup: boolean;
    db: ToolContext["db"];
  }
): Promise<Message[]> {
  const resultMessages: Message[] = [];
  const observingHookPromises: Promise<void>[] = [];

  for (let i = 0; i < toolPlans.length; i++) {
    const plan = toolPlans[i];
    const { block } = plan;
    const exec = execResults[i];

    // Hook: tool:error (if execution threw) — fire-and-forget (observing)
    if (exec.execError && hookRunner) {
      const errorEvent: ToolErrorEvent = {
        toolName: block.name,
        params: structuredClone(plan.params),
        error: exec.execError.message,
        stack: exec.execError.stack,
        chatId: sink.chatId,
        isGroup: sink.effectiveIsGroup,
        durationMs: exec.durationMs,
      };
      observingHookPromises.push(hookRunner.runObservingHook("tool:error", errorEvent));
    }

    // Hook: tool:after (fires for all cases including blocks) — fire-and-forget (observing)
    if (hookRunner) {
      const afterEvent: AfterToolCallEvent = {
        toolName: block.name,
        params: structuredClone(plan.params),
        result: {
          success: exec.result.success,
          data: exec.result.data,
          error: exec.result.error,
        },
        durationMs: exec.durationMs,
        chatId: sink.chatId,
        isGroup: sink.effectiveIsGroup,
        ...(plan.blocked ? { blocked: true, blockReason: plan.blockReason } : {}),
      };
      observingHookPromises.push(hookRunner.runObservingHook("tool:after", afterEvent));
    }

    const toolHint = summarizeToolParams(block.name, plan.params);
    log.debug(`${block.name}: ${exec.result.success ? "✓" : "✗"} ${exec.result.error || ""}`);
    sink.iterationToolNames.push(`${block.name}${toolHint} ${exec.result.success ? "✓" : "✗"}`);

    sink.totalToolCalls.push({
      name: block.name,
      input: plan.params,
      durationMs: exec.durationMs,
      attempted: exec.attempted,
      result: {
        success: exec.result.success,
        data: exec.result.data,
        error: exec.result.error,
      },
    });

    const fullResultText = serializeToolResult(exec.result);
    let resultText = truncateToolResult(exec.result, MAX_TOOL_RESULT_SIZE);
    if (fullResultText.length > MAX_TOOL_RESULT_SIZE) {
      try {
        const artifact = createToolResultArtifact(sink.db, {
          sessionId: sink.sessionId,
          chatId: sink.chatId,
          toolName: block.name,
          content: fullResultText,
        });
        resultText = attachArtifactReference(resultText, artifact);
      } catch (error) {
        log.error({ err: error }, `Failed to persist large result for ${block.name}`);
      }
    }
    if (resultText.includes('"_truncated":true')) {
      log.warn(`Tool result too large, truncated to ${resultText.length} chars`);
    }

    const resultMsg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: block.id,
      toolName: block.name,
      content: [{ type: "text", text: resultText }],
      isError: !exec.result.success,
      timestamp: Date.now(),
    };
    resultMessages.push(resultMsg);
    appendToTranscript(sink.sessionId, resultMsg);
  }

  // Await all observing hooks from Phase 3 (non-blocking during result processing)
  if (observingHookPromises.length > 0) {
    await Promise.allSettled(observingHookPromises);
  }

  return resultMessages;
}

export function injectDiscoveredTools(
  toolPlans: ToolPlan[],
  execResults: ToolExecResult[],
  tools: PiAiTool[],
  maxTools: number | null = null,
  excludedNames: ReadonlySet<string> = new Set()
): number {
  let injected = 0;
  for (let index = 0; index < toolPlans.length; index++) {
    const plan = toolPlans[index];
    const exec = execResults[index];
    if (
      plan.block.name !== "tool_search" ||
      !exec.result.success ||
      !exec.result.data ||
      typeof exec.result.data !== "object" ||
      !("tools" in exec.result.data)
    ) {
      continue;
    }
    const discovered = (exec.result.data as { tools: PiAiTool[] }).tools;
    if (!Array.isArray(discovered)) continue;
    const available: PiAiTool[] = [];
    for (const tool of discovered) {
      if (!tool?.name || excludedNames.has(tool.name)) continue;
      if (tools.some((existing) => existing.name === tool.name)) {
        available.push(tool);
        continue;
      }
      if (maxTools === null || tools.length < maxTools) {
        tools.push(tool);
        available.push(tool);
        injected++;
      }
    }
    const data = exec.result.data as Record<string, unknown>;
    data.tools = available;
    data.tools_found = available.length;
    data.hint =
      available.length > 0
        ? "These tools are now available. Call them directly."
        : "No additional tools could be loaded in this context.";
  }
  return injected;
}
