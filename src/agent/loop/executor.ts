import { createHash } from "node:crypto";
import { createToolResultArtifact } from "../../memory/tool-result-artifacts.js";
import type { ObservationArtifactStore } from "../context-budget.js";
import type { Context } from "@earendil-works/pi-ai";
import type { Config } from "../../config/schema.js";
import { getProviderMetadata } from "../../config/providers.js";
import { TELEGRAM_SEND_TOOLS } from "../../constants/tools.js";
import { maskOldToolResults } from "../../memory/observation-masking.js";
import type { createHookRunner } from "../../sdk/hooks/runner.js";
import { isBotBridge } from "../../telegram/bridge-guards.js";
import { createLogger } from "../../utils/logger.js";
import { resolveModelTarget } from "../model-target.js";
import { resolveProviderFallback } from "../provider-fallback.js";
import { addUsage } from "../runtime-utils.js";
import type { CompletedToolCall } from "../telegram-send-state.js";
import { enforceProviderToolLimit } from "../tool-selector.js";
import type { AgentTurnTraceRecorder } from "../turn-trace.js";
import type { LoopResult, ProcessMessageOptions, TurnContext } from "../turn-types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { recoverLlmError, runModelIteration } from "./llm-iteration.js";
import { executeToolBatch, injectDiscoveredTools, recordToolResults } from "./tool-batch.js";
import { ContextBudgetError } from "../context-budget.js";
import { TurnBudgetError } from "../turn-budget.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export interface AgentLoopDependencies {
  config: Config;
  toolRegistry: ToolRegistry | null;
  hookRunner?: HookRunner;
}

export async function executeAgentLoop(
  turn: TurnContext,
  opts: ProcessMessageOptions,
  trace: AgentTurnTraceRecorder,
  deps: AgentLoopDependencies
): Promise<LoopResult> {
  const { chatId, effectiveIsGroup, processStartTime, systemPrompt, userMsg, sessionKey } = turn;
  const { toolContext } = opts;
  let session = turn.session;
  let context = turn.context;
  let activeProvider = turn.provider;
  let activeAgentConfig = deps.config.agent;
  let activeTools = turn.tools ? [...turn.tools] : undefined;
  let fallbackIndex = 0;

  const maxIterations = Math.max(1, deps.config.agent.max_agentic_iterations || 5);
  const maxDurationMs = Math.max(10_000, deps.config.agent.max_turn_duration_ms);
  const deadlineAt = opts.admission?.executionDeadline ?? processStartTime + maxDurationMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(),
    Math.max(1, deadlineAt - Date.now())
  );
  const deadlineSignal = deadlineController.signal;
  const providerSignal = opts.admission?.signal
    ? AbortSignal.any([deadlineSignal, opts.admission.signal])
    : deadlineSignal;
  let iteration = 0;
  const retry = { overflowResets: 0, rateLimitRetries: 0, serverErrorRetries: 0 };
  let finalResponse: LoopResult["finalResponse"] = null;
  let lastResponse: LoopResult["finalResponse"] = null;
  let stopReason = "completed";
  let forcedContent: string | undefined;
  const totalToolCalls: CompletedToolCall[] = [];
  const accumulatedTexts: string[] = [];
  const accumulatedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 };
  let wasStreamed = false;
  let streamAccumulatedText = "";
  const observationArtifacts = new Map<string, { id: string; sizeBytes: number }>();
  const storeObservation: ObservationArtifactStore | undefined = toolContext
    ? (message) => {
        const content = JSON.stringify(message);
        const key = createHash("sha256").update(content).digest("hex");
        const existing = observationArtifacts.get(key);
        if (existing) return existing;
        try {
          const artifact = createToolResultArtifact(toolContext.db, {
            sessionId: session.sessionId,
            chatId,
            toolName: message.toolName,
            content,
          });
          const reference = { id: artifact.id, sizeBytes: artifact.sizeBytes };
          observationArtifacts.set(key, reference);
          return reference;
        } catch (error) {
          log.warn(
            { err: error },
            "Cannot preserve optional observation for context fitting; keeping its body"
          );
          return undefined;
        }
      }
    : undefined;

  if (storeObservation)
    storeObservation.isObservation = (name) =>
      deps.toolRegistry?.getToolCategory(name) === "data-bearing";
  try {
    while (iteration < maxIterations) {
      if (Date.now() >= deadlineAt || providerSignal.aborted) {
        stopReason =
          opts.admission?.signal?.aborted && Date.now() < deadlineAt ? "aborted" : "time_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its time budget. " +
          "Send a follow-up to continue.";
        finalResponse = lastResponse;
        break;
      }

      iteration++;
      log.debug(`Agentic iteration ${iteration}/${maxIterations}`);

      const iterationStartIndex = context.messages.length;
      const maskedMessages = maskOldToolResults(context.messages, {
        toolRegistry: deps.toolRegistry ?? undefined,
        currentIterationStartIndex: iterationStartIndex,
      });
      const maskedContext: Context = { ...context, messages: maskedMessages };

      let iterationResult: Awaited<ReturnType<typeof runModelIteration>>;
      try {
        iterationResult = await runModelIteration(
          activeAgentConfig,
          opts.streamToChat,
          maskedContext,
          systemPrompt,
          session.sessionId,
          activeTools,
          streamAccumulatedText,
          providerSignal,
          Math.max(1, deadlineAt - Date.now()),
          turn.turnId,
          storeObservation
        );
      } catch (error) {
        if (
          error instanceof ContextBudgetError ||
          error instanceof TurnBudgetError ||
          providerSignal.aborted
        ) {
          stopReason =
            error instanceof ContextBudgetError
              ? "context_budget"
              : opts.admission?.signal?.aborted && Date.now() < deadlineAt
                ? "aborted"
                : "time_budget";
          forcedContent =
            "I stopped before starting more work because this turn reached its budget. Previous action receipts have been preserved.";
          finalResponse = lastResponse;
          break;
        }
        throw error;
      }
      const response = iterationResult.response;
      lastResponse = response;
      const streamed = iterationResult.streamed;
      wasStreamed ||= streamed;
      streamAccumulatedText = iterationResult.streamAccumulatedText;

      const assistantMsg = response.message;
      const iterUsage = response.message.usage;
      if (iterUsage) addUsage(accumulatedUsage, iterUsage);
      trace.progress(totalToolCalls, iteration, accumulatedUsage);

      if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "length") {
        stopReason =
          assistantMsg.stopReason === "length"
            ? "model_length"
            : Date.now() >= deadlineAt
              ? "time_budget"
              : "aborted";
        forcedContent =
          "The model response was interrupted or incomplete. No tools from that response were executed.";
        finalResponse = response;
        break;
      }

      if (assistantMsg.stopReason === "error") {
        try {
          const recovered = await recoverLlmError(
            activeAgentConfig,
            deps.hookRunner,
            assistantMsg,
            retry,
            {
              session,
              context,
              chatId,
              sessionKey,
              effectiveIsGroup,
              provider: activeProvider,
              processStartTime,
              userMsg,
              deadlineAt,
              signal: providerSignal,
              systemPrompt,
              tools: activeTools,
            }
          );
          session = recovered.session;
          context = recovered.context;
          iteration--;
          continue;
        } catch (error) {
          if (error instanceof TurnBudgetError || error instanceof ContextBudgetError) {
            stopReason =
              error instanceof ContextBudgetError
                ? "context_budget"
                : opts.admission?.signal?.aborted && Date.now() < deadlineAt
                  ? "aborted"
                  : "time_budget";
            forcedContent =
              "I stopped at the turn budget. Previous action results have been preserved; no automatic retry was started.";
            finalResponse = response;
            break;
          }
          const actionAlreadyAttempted = totalToolCalls.some(
            (call) =>
              call.attempted !== false &&
              deps.toolRegistry?.getToolCategory(call.name) !== "data-bearing"
          );
          const previousProvider = activeProvider;
          const previousModel = activeAgentConfig.model;
          const fallback = resolveProviderFallback(
            deps.config.agent,
            fallbackIndex,
            assistantMsg.errorMessage || "",
            actionAlreadyAttempted
          );
          if (!fallback) throw error;

          fallbackIndex = fallback.nextIndex;
          activeProvider = fallback.provider;
          activeAgentConfig = fallback.config;
          const fallbackTarget = resolveModelTarget(
            activeProvider,
            activeAgentConfig.model,
            activeAgentConfig.base_url
          );
          trace.updateTarget(
            activeProvider,
            fallbackTarget.resolvedModel,
            fallbackTarget.endpointFingerprint
          );
          retry.overflowResets = 0;
          retry.rateLimitRetries = 0;
          retry.serverErrorRetries = 0;
          const fallbackLimit = getProviderMetadata(activeProvider).toolLimit;
          if (activeTools) activeTools = enforceProviderToolLimit(activeTools, fallbackLimit);
          streamAccumulatedText = "";
          if (opts.streamToChat && isBotBridge(opts.streamToChat.bridge)) {
            await opts.streamToChat.bridge.clearDraft(opts.streamToChat.chatId);
          }
          log.warn(
            `Provider fallback: ${previousProvider}/${previousModel} → ` +
              `${activeProvider}/${activeAgentConfig.model}`
          );
          iteration--;
          continue;
        }
      }

      if (Date.now() >= deadlineAt || providerSignal.aborted) {
        stopReason =
          opts.admission?.signal?.aborted && Date.now() < deadlineAt ? "aborted" : "time_budget";
        forcedContent =
          "The turn was interrupted before accepting the model response. No tools from that response were executed.";
        finalResponse = response;
        break;
      }

      if (response.text) accumulatedTexts.push(response.text);
      const toolCalls = response.message.content.filter((block) => block.type === "toolCall");

      if (toolCalls.length === 0) {
        log.info(`${iteration}/${maxIterations} → done`);
        finalResponse = response;
        wasStreamed = streamed;
        stopReason = fallbackIndex > 0 ? "completed_with_fallback" : "completed";
        break;
      }

      if (!deps.toolRegistry || !toolContext) {
        log.error("Cannot execute tools: registry or context missing");
        break;
      }

      log.debug(`Executing ${toolCalls.length} tool call(s)`);
      context.messages.push(response.message);
      const iterationToolNames: string[] = [];
      const fullContext: ToolContext = {
        ...toolContext,
        chatId,
        isGroup: effectiveIsGroup,
        isGuest: opts.isGuest,
        turnId: turn.turnId,
        sessionId: session.sessionId,
        logicalSessionKey: sessionKey,
        deadlineAt,
        signal: providerSignal,
      };

      const { toolPlans, execResults } = await executeToolBatch(
        deps.toolRegistry,
        deps.hookRunner,
        toolCalls,
        fullContext,
        chatId,
        effectiveIsGroup
      );

      if (activeTools) {
        const injected = injectDiscoveredTools(
          toolPlans,
          execResults,
          activeTools,
          getProviderMetadata(activeProvider).toolLimit,
          opts.isGuest ? TELEGRAM_SEND_TOOLS : undefined
        );
        if (injected > 0) {
          log.info(
            `ToolSearch: injected ${injected} tool(s) mid-loop (total: ${activeTools.length})`
          );
        }
      }

      const resultMessages = await recordToolResults(deps.hookRunner, toolPlans, execResults, {
        totalToolCalls,
        iterationToolNames,
        sessionId: session.sessionId,
        chatId,
        effectiveIsGroup,
        db: fullContext.db,
      });
      for (const resultMsg of resultMessages) context.messages.push(resultMsg);

      trace.progress(totalToolCalls, iteration, accumulatedUsage);
      log.info(`${iteration}/${maxIterations} → ${iterationToolNames.join(", ")}`);

      const uncertain = execResults.some(
        ({ result }) =>
          result.execution?.outcome === "unknown" ||
          result.execution?.persistence === "persistence_failed"
      );
      if (uncertain || toolPlans.some((plan) => plan.blocked)) {
        stopReason = uncertain ? "effect_unknown" : "hook_blocked";
        forcedContent = uncertain
          ? "An action's outcome or its durable receipt is uncertain. It will not be retried automatically; review the recorded operation before continuing."
          : "A tool was blocked by an enforcement hook. No automatic retry was started.";
        finalResponse = response;
        break;
      }
      if (Date.now() >= deadlineAt || providerSignal.aborted) {
        stopReason = "time_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its time budget. " +
          "Send a follow-up to continue.";
        finalResponse = response;
        break;
      }
      if (iteration === maxIterations) {
        log.info(`Max iterations reached (${maxIterations})`);
        finalResponse = response;
        stopReason = "iteration_budget";
        forcedContent =
          "I stopped at a safe boundary because this turn reached its iteration budget. " +
          "Send a follow-up to continue.";
      }
    }

    if (finalResponse && !context.messages.includes(finalResponse.message)) {
      context.messages.push(finalResponse.message);
    }

    return {
      finalResponse,
      session,
      context,
      totalToolCalls,
      accumulatedTexts,
      accumulatedUsage,
      wasStreamed,
      iterations: iteration,
      stopReason,
      activeProvider,
      activeModel: lastResponse?.message.model ?? activeAgentConfig.model,
      forcedContent,
    };
  } finally {
    clearTimeout(deadlineTimer);
  }
}
