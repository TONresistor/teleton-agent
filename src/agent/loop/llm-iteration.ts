import type {
  AssistantMessage,
  Context,
  Tool as PiAiTool,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { Config } from "../../config/schema.js";
import type { SupportedProvider } from "../../config/providers.js";
import { RATE_LIMIT_MAX_RETRIES, SERVER_ERROR_MAX_RETRIES } from "../../constants/limits.js";
import type { createHookRunner } from "../../sdk/hooks/runner.js";
import type { ResponseErrorEvent } from "../../sdk/hooks/types.js";
import type { getOrCreateSession } from "../../session/store.js";
import type { ITelegramBridge } from "../../telegram/bridge-interface.js";
import { isBotBridge } from "../../telegram/bridge-guards.js";
import { createLogger } from "../../utils/logger.js";
import { chatWithContext, streamWithContext, type ChatResponse } from "../client.js";
import { classifyLlmError, parseRetryAfterMs } from "../runtime-utils.js";
import { preserveActionReceipts, preserveUserRequirements } from "../../memory/action-receipts.js";
import { assertTurnBudget, budgetSleep } from "../turn-budget.js";
import { compactContext } from "../../memory/compaction.js";
import { getProviderModel } from "../../providers/model-resolver.js";
import { getEffectiveApiKey, prepareModelRequest } from "../model-request.js";
import {
  ContextBudgetError,
  estimateRequestTokens,
  CONTEXT_BUDGET_MARGIN,
  CONTEXT_BUDGET_SAFETY_FACTOR,
  type ObservationArtifactStore,
} from "../context-budget.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export interface StreamTarget {
  chatId: string;
  bridge: ITelegramBridge;
  mode: "all" | "replace" | "off";
}

export interface RetryState {
  overflowResets: number;
  rateLimitRetries: number;
  serverErrorRetries: number;
}

/** Run one LLM completion, optionally streaming a bot draft. */
export async function runModelIteration(
  agentConfig: Config["agent"],
  streamTarget: StreamTarget | undefined,
  maskedContext: Context,
  systemPrompt: string,
  sessionId: string,
  tools: PiAiTool[] | undefined,
  streamAccumulatedText: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  turnId?: string,
  storeObservation?: ObservationArtifactStore
): Promise<{ response: ChatResponse; streamed: boolean; streamAccumulatedText: string }> {
  const streamMode = streamTarget?.mode;
  const shouldStream =
    streamTarget?.bridge.streamResponse && streamMode !== undefined && streamMode !== "off";
  if (!shouldStream) {
    const response = await chatWithContext(agentConfig, {
      systemPrompt,
      context: maskedContext,
      sessionId,
      persistTranscript: true,
      turnId,
      tools,
      signal,
      timeoutMs,
      storeObservation,
    });
    return { response, streamed: false, streamAccumulatedText };
  }

  const bridge = streamTarget.bridge;
  if (!isBotBridge(bridge)) {
    const response = await chatWithContext(agentConfig, {
      systemPrompt,
      context: maskedContext,
      sessionId,
      persistTranscript: true,
      turnId,
      tools,
      signal,
      timeoutMs,
      storeObservation,
    });
    return { response, streamed: false, streamAccumulatedText };
  }

  if (streamMode === "replace") {
    bridge.resetDraft(streamTarget.chatId);
    streamAccumulatedText = "";
  }
  const { textStream, result } = streamWithContext(agentConfig, {
    systemPrompt,
    context: maskedContext,
    sessionId,
    persistTranscript: true,
    turnId,
    tools,
    signal,
    timeoutMs,
    storeObservation,
  });
  void result.catch(() => {});
  const prefix = streamMode === "all" ? streamAccumulatedText : "";
  async function* prefixedStream(): AsyncIterable<string> {
    let first = true;
    for await (const chunk of textStream) {
      if (first && prefix) {
        yield prefix + chunk;
        first = false;
      } else {
        yield chunk;
      }
    }
  }

  const draftText = await bridge.streamDraft(streamTarget.chatId, prefixedStream());
  if (streamMode === "all") {
    if (draftText.length === 0 && streamAccumulatedText.length > 0) {
      await bridge.clearDraft(streamTarget.chatId);
    }
    streamAccumulatedText = draftText + "\n\n";
  }
  return { response: await result, streamed: true, streamAccumulatedText };
}

export interface LlmErrorContext {
  session: ReturnType<typeof getOrCreateSession>;
  context: Context;
  chatId: string;
  sessionKey: string;
  effectiveIsGroup: boolean;
  provider: SupportedProvider;
  processStartTime: number;
  userMsg: UserMessage;
  deadlineAt?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
  tools?: PiAiTool[];
}

/** Classify an LLM failure and either recover its context or throw a terminal error. */
export async function recoverLlmError(
  agentConfig: Config["agent"],
  hookRunner: HookRunner | undefined,
  assistantMsg: AssistantMessage,
  retry: RetryState,
  ctx: LlmErrorContext
): Promise<{ session: ReturnType<typeof getOrCreateSession>; context: Context }> {
  const session = ctx.session;
  let context = ctx.context;
  const errorMsg = assistantMsg.errorMessage || "";
  const errorClass = classifyLlmError(errorMsg);

  if (hookRunner) {
    const responseErrorEvent: ResponseErrorEvent = {
      chatId: ctx.chatId,
      sessionId: session.sessionId,
      isGroup: ctx.effectiveIsGroup,
      error: errorMsg,
      errorCode: errorClass.code,
      provider: ctx.provider,
      model: agentConfig.model,
      retryCount: retry.rateLimitRetries + retry.serverErrorRetries,
      durationMs: Date.now() - ctx.processStartTime,
    };
    await hookRunner.runObservingHook("response:error", responseErrorEvent);
  }

  if (errorClass.kind === "context_overflow") {
    retry.overflowResets++;
    const model = getProviderModel(ctx.provider, agentConfig.model, agentConfig.base_url);
    const overflowError = (input: Context) =>
      new ContextBudgetError(
        Math.ceil(estimateRequestTokens(input) * CONTEXT_BUDGET_SAFETY_FACTOR) +
          CONTEXT_BUDGET_MARGIN,
        model.contextWindow,
        model.id
      );
    if (retry.overflowResets > 1) throw overflowError(context);
    assertTurnBudget(ctx.deadlineAt, ctx.signal);
    const original: Context = {
      ...context,
      systemPrompt: ctx.systemPrompt ?? context.systemPrompt,
      tools: ctx.tools ?? context.tools,
    };
    log.warn(
      "Provider context overflow; compacting without resetting the session or discarding user requirements"
    );
    const compacted = await compactContext(
      original,
      {
        enabled: true,
        maxTokens: model.contextWindow,
        keepRecentMessages: Math.min(10, Math.max(1, original.messages.length - 1)),
        memoryFlushEnabled: false,
      },
      getEffectiveApiKey(ctx.provider, agentConfig.api_key),
      ctx.provider,
      agentConfig.utility_model
    );
    assertTurnBudget(ctx.deadlineAt, ctx.signal);
    const recovered = preserveActionReceipts(
      preserveUserRequirements(compacted, original.messages),
      original.messages
    );
    // Do not repeat an unchanged payload after the provider has rejected it.
    if (estimateRequestTokens(recovered) >= estimateRequestTokens(original))
      throw overflowError(recovered);
    prepareModelRequest(agentConfig, {
      context: recovered,
      systemPrompt: original.systemPrompt,
      tools: original.tools,
      maxTokens: agentConfig.max_tokens,
      signal: ctx.signal,
    });
    context = recovered;
    return { session, context };
  }

  if (errorClass.kind === "rate_limit") {
    retry.rateLimitRetries++;
    if (retry.rateLimitRetries <= RATE_LIMIT_MAX_RETRIES) {
      const base = parseRetryAfterMs(errorMsg) ?? 1000 * 2 ** (retry.rateLimitRetries - 1);
      const delay = base + Math.floor(Math.random() * 500);
      log.warn(
        `Rate limited, retrying in ${delay}ms (attempt ${retry.rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES})...`
      );
      await budgetSleep(
        delay,
        ctx.deadlineAt ?? ctx.processStartTime + agentConfig.max_turn_duration_ms,
        ctx.signal
      );
      return { session, context };
    }
    log.error(`Rate limited after ${RATE_LIMIT_MAX_RETRIES} retries: ${errorMsg}`);
    throw new Error(
      `API rate limited after ${RATE_LIMIT_MAX_RETRIES} retries. Please try again later.`
    );
  }

  if (errorClass.kind === "server_error") {
    retry.serverErrorRetries++;
    if (retry.serverErrorRetries <= SERVER_ERROR_MAX_RETRIES) {
      const delay = 2000 * 2 ** (retry.serverErrorRetries - 1) + Math.floor(Math.random() * 500);
      log.warn(
        `Server error, retrying in ${delay}ms (attempt ${retry.serverErrorRetries}/${SERVER_ERROR_MAX_RETRIES})...`
      );
      await budgetSleep(
        delay,
        ctx.deadlineAt ?? ctx.processStartTime + agentConfig.max_turn_duration_ms,
        ctx.signal
      );
      return { session, context };
    }
    log.error(`Server error after ${SERVER_ERROR_MAX_RETRIES} retries: ${errorMsg}`);
    throw new Error(
      `API server error after ${SERVER_ERROR_MAX_RETRIES} retries. The provider may be experiencing issues.`
    );
  }

  log.error(`API error: ${errorMsg}`);
  throw new Error(`API error: ${errorMsg || "Unknown error"}`);
}
