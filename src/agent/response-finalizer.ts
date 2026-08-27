import type { createHookRunner } from "../sdk/hooks/runner.js";
import type { ResponseAfterEvent, ResponseBeforeEvent } from "../sdk/hooks/types.js";
import { updateSession } from "../session/store.js";
import { isBotBridge } from "../telegram/bridge-guards.js";
import { createLogger } from "../utils/logger.js";
import type { ChatResponse } from "./client.js";
import { accumulateTokenUsage } from "./token-usage.js";
import { deliveredTelegramText, sentSuccessfullyToChat } from "./telegram-send-state.js";
import type {
  AgentResponse,
  LoopResult,
  ProcessMessageOptions,
  TurnContext,
} from "./turn-types.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export async function finalizeAgentResponse(
  turn: TurnContext,
  loop: LoopResult,
  finalResponse: ChatResponse,
  opts: ProcessMessageOptions,
  hookRunner?: HookRunner
): Promise<AgentResponse> {
  const { chatId, effectiveIsGroup, processStartTime } = turn;
  const { session, totalToolCalls, accumulatedTexts, accumulatedUsage, wasStreamed } = loop;

  // Post-loop compaction is deferred to the pre-loop check at the start of the
  // next processMessage(), avoiding AI summarization latency during delivery.
  const sessionUpdate: Parameters<typeof updateSession>[1] = {
    updatedAt: Date.now(),
    messageCount: session.messageCount + 1,
    model: loop.activeModel,
    provider: loop.activeProvider,
    inputTokens:
      (session.inputTokens ?? 0) +
      accumulatedUsage.input +
      accumulatedUsage.cacheRead +
      accumulatedUsage.cacheWrite,
    outputTokens: (session.outputTokens ?? 0) + accumulatedUsage.output,
  };
  updateSession(opts.sessionKey ?? chatId, sessionUpdate);

  if (accumulatedUsage.input > 0 || accumulatedUsage.output > 0) {
    const u = accumulatedUsage;
    const totalInput = u.input + u.cacheRead + u.cacheWrite;
    const inK = (totalInput / 1000).toFixed(1);
    const cacheParts: string[] = [];
    if (u.cacheRead) cacheParts.push(`${(u.cacheRead / 1000).toFixed(1)}K cached`);
    if (u.cacheWrite) cacheParts.push(`${(u.cacheWrite / 1000).toFixed(1)}K new`);
    const cacheInfo = cacheParts.length > 0 ? ` (${cacheParts.join(", ")})` : "";
    log.info(`${inK}K in${cacheInfo}, ${u.output} out | $${u.totalCost.toFixed(3)}`);
    accumulateTokenUsage(u);
  }

  let content = loop.forcedContent ?? (accumulatedTexts.join("\n").trim() || finalResponse.text);
  const sentToCurrentChat = totalToolCalls.some((call) => sentSuccessfullyToChat(call, chatId));

  if (!content && totalToolCalls.length > 0 && !sentToCurrentChat) {
    log.warn("Empty response after tool calls - generating fallback");
    content = "I executed the requested action but couldn't generate a response. Please try again.";
  } else if (!content && sentToCurrentChat) {
    log.info("Response sent via Telegram tool - no additional text needed");
    content = "";
  } else if (!content && accumulatedUsage.input === 0 && accumulatedUsage.output === 0) {
    log.warn("Empty response with zero tokens - possible API issue");
    content = "I couldn't process your request. Please try again.";
  }

  let responseMetadata: Record<string, unknown> = {};
  if (hookRunner) {
    const responseBeforeEvent: ResponseBeforeEvent = {
      chatId,
      sessionId: session.sessionId,
      isGroup: effectiveIsGroup,
      originalText: content,
      text: content,
      block: false,
      blockReason: "",
      metadata: {},
    };
    await hookRunner.runModifyingHook("response:before", responseBeforeEvent);
    if (responseBeforeEvent.block) {
      log.info(`🚫 Response blocked by hook: ${responseBeforeEvent.blockReason || "no reason"}`);
      content = responseBeforeEvent.blockReason.startsWith("Hook enforcement failed")
        ? "Response withheld because an enforcement hook failed. Check the agent logs."
        : "";
    } else {
      content = responseBeforeEvent.text;
    }
    responseMetadata = responseBeforeEvent.metadata;
  }

  if (hookRunner) {
    const responseAfterEvent: ResponseAfterEvent = {
      chatId,
      sessionId: session.sessionId,
      isGroup: effectiveIsGroup,
      text: content,
      durationMs: Date.now() - processStartTime,
      toolsUsed: totalToolCalls.map((call) => call.name),
      tokenUsage:
        accumulatedUsage.input > 0 || accumulatedUsage.output > 0
          ? { input: accumulatedUsage.input, output: accumulatedUsage.output }
          : undefined,
      metadata: responseMetadata,
    };
    await hookRunner.runObservingHook("response:after", responseAfterEvent);
  }

  if (wasStreamed && opts.streamToChat) {
    const bridge = opts.streamToChat.bridge;
    if (isBotBridge(bridge)) {
      if (
        (!content && sentToCurrentChat) ||
        deliveredTelegramText(totalToolCalls, chatId, content)
      ) {
        await bridge.clearDraft(opts.streamToChat.chatId);
      } else {
        await bridge.finalizeDraft(opts.streamToChat.chatId, content);
      }
    }
  }

  return { content, toolCalls: totalToolCalls, streamed: wasStreamed };
}
