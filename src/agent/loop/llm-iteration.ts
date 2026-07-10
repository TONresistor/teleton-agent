import type {
  AssistantMessage,
  Context,
  Tool as PiAiTool,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { Config } from "../../config/schema.js";
import type { SupportedProvider } from "../../config/providers.js";
import {
  CONTEXT_OVERFLOW_SUMMARY_MESSAGES,
  RATE_LIMIT_MAX_RETRIES,
  SERVER_ERROR_MAX_RETRIES,
} from "../../constants/limits.js";
import { appendToDailyLog } from "../../memory/daily-logs.js";
import type { createHookRunner } from "../../sdk/hooks/runner.js";
import type { ResponseErrorEvent } from "../../sdk/hooks/types.js";
import { resetSession } from "../../session/store.js";
import type { getOrCreateSession } from "../../session/store.js";
import { appendToTranscript, archiveTranscript } from "../../session/transcript.js";
import type { ITelegramBridge } from "../../telegram/bridge-interface.js";
import { isBotBridge } from "../../telegram/bridge-guards.js";
import { createLogger } from "../../utils/logger.js";
import { chatWithContext, streamWithContext, type ChatResponse } from "../client.js";
import { classifyLlmError, extractContextSummary, parseRetryAfterMs } from "../runtime-utils.js";

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
  streamAccumulatedText: string
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
      tools,
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
      tools,
    });
    return { response, streamed: true, streamAccumulatedText };
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
    tools,
  });
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
  effectiveIsGroup: boolean;
  provider: SupportedProvider;
  processStartTime: number;
  userMsg: UserMessage;
}

/** Classify an LLM failure and either recover its context or throw a terminal error. */
export async function recoverLlmError(
  agentConfig: Config["agent"],
  hookRunner: HookRunner | undefined,
  assistantMsg: AssistantMessage,
  retry: RetryState,
  ctx: LlmErrorContext
): Promise<{ session: ReturnType<typeof getOrCreateSession>; context: Context }> {
  let session = ctx.session;
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
    if (retry.overflowResets > 1) {
      throw new Error(
        "Context overflow persists after session reset. Message may be too large for the model's context window."
      );
    }
    log.error(`Context overflow detected: ${errorMsg}`);
    log.info("Saving session memory before reset...");
    appendToDailyLog(extractContextSummary(context, CONTEXT_OVERFLOW_SUMMARY_MESSAGES));
    log.info("Memory saved to daily log");
    if (!archiveTranscript(session.sessionId)) {
      log.error(`Failed to archive transcript ${session.sessionId}, proceeding with reset anyway`);
    }
    log.info("Resetting session due to context overflow...");
    session = resetSession(ctx.chatId);
    context = { messages: [ctx.userMsg] };
    appendToTranscript(session.sessionId, ctx.userMsg);
    log.info("Retrying with fresh context...");
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
      await new Promise((resolve) => setTimeout(resolve, delay));
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
      await new Promise((resolve) => setTimeout(resolve, delay));
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
