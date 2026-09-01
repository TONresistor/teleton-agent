import { randomUUID } from "node:crypto";
import type { Context, UserMessage } from "@earendil-works/pi-ai";
import type { Config } from "../config/schema.js";
import { getProviderMetadata, type SupportedProvider } from "../config/providers.js";
import { CONTEXT_MAX_RECENT_MESSAGES, CONTEXT_MAX_RELEVANT_CHUNKS } from "../constants/limits.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { formatMessageEnvelope } from "../memory/envelope.js";
import type { CompactionManager } from "../memory/compaction.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import type { ContextBuilder } from "../memory/search/context.js";
import type { createHookRunner } from "../sdk/hooks/runner.js";
import type {
  BeforePromptBuildEvent,
  MessageReceiveEvent,
  PromptAfterEvent,
} from "../sdk/hooks/types.js";
import { formatEmotionalState, updateEmotionalState } from "./emotions.js";
import { formatRelationshipProfile, RelationshipStore } from "../memory/feed/relationships.js";
import { saveSessionMemory } from "../session/memory-hook.js";
import {
  getOrCreateSession,
  getSession,
  resetSessionWithPolicy,
  shouldResetSession,
  updateSession,
} from "../session/store.js";
import { appendToTranscript, transcriptExists } from "../session/transcript.js";
import { buildSystemPrompt, captureMemorySnapshot, clearMemorySnapshot } from "../soul/loader.js";
import { createLogger } from "../utils/logger.js";
import { sanitizeForContext } from "../utils/sanitize.js";
import { getEffectiveApiKey, loadContextFromTranscript } from "./client.js";
import type { UserHookEvaluator } from "./hooks/user-hook-evaluator.js";
import { resolveModelTarget } from "./model-target.js";
import { isTrivialMessage } from "./runtime-utils.js";
import { computeRagEmbedding, selectTools } from "./tool-selector.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ProcessMessageOptions, TurnContextResult } from "./turn-types.js";

const log = createLogger("Agent");
type HookRunner = ReturnType<typeof createHookRunner>;

export interface TurnPreparationDependencies {
  config: Config;
  soul: string;
  compactionManager: CompactionManager;
  contextBuilder: ContextBuilder | null;
  embedder: EmbeddingProvider | null;
  toolRegistry: ToolRegistry | null;
  hookRunner?: HookRunner;
  userHookEvaluator?: UserHookEvaluator;
  getMemoryStats(): { totalMessages: number; totalChats: number; knowledgeChunks: number };
}

export async function prepareTurn(
  opts: ProcessMessageOptions,
  processStartTime: number,
  deps: TurnPreparationDependencies
): Promise<TurnContextResult> {
  const {
    chatId,
    userMessage,
    userName,
    timestamp,
    isGroup,
    pendingContext,
    toolContext,
    senderUsername,
    senderRank,
    hasMedia,
    mediaType,
    messageId,
    replyContext,
    reactionSummary,
    isHeartbeat,
  } = opts;

  const effectiveIsGroup = isGroup ?? false;

  // User hooks: keyword blocklist + context injection (hot-reloadable, no restart)
  let userHookContext = "";
  if (deps.userHookEvaluator) {
    const hookResult = deps.userHookEvaluator.evaluate(userMessage);
    if (hookResult.blocked) {
      log.info("Message blocked by keyword filter");
      return {
        kind: "early",
        response: { content: hookResult.blockMessage ?? "", toolCalls: [] },
      };
    }
    if (hookResult.additionalContext) {
      userHookContext = sanitizeForContext(hookResult.additionalContext);
    }
  }

  // Hook: message:receive — plugins can block, mutate text, inject context
  let effectiveMessage = userMessage;
  let hookMessageContext = "";
  if (deps.hookRunner) {
    const msgEvent: MessageReceiveEvent = {
      chatId,
      senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
      senderName: userName ?? "",
      isGroup: effectiveIsGroup,
      isReply: !!replyContext,
      replyToMessageId: replyContext ? messageId : undefined,
      messageId: messageId ?? 0,
      timestamp: timestamp ?? Date.now(),
      text: userMessage,
      block: false,
      blockReason: "",
      additionalContext: "",
    };
    await deps.hookRunner.runModifyingHook("message:receive", msgEvent);
    if (msgEvent.block) {
      log.info(`Message blocked by hook: ${msgEvent.blockReason || "no reason"}`);
      const content = msgEvent.blockReason.startsWith("Hook enforcement failed")
        ? "Request blocked because an enforcement hook failed. Check the agent logs."
        : "";
      return { kind: "early", response: { content, toolCalls: [] } };
    }
    effectiveMessage = sanitizeForContext(msgEvent.text);
    if (msgEvent.additionalContext) {
      hookMessageContext = sanitizeForContext(msgEvent.additionalContext);
    }
  }

  const sessionKey = opts.sessionKey ?? chatId;
  let session = getOrCreateSession(sessionKey);
  const now = timestamp ?? Date.now();

  const resetPolicy = deps.config.agent.session_reset_policy;
  if (shouldResetSession(session, resetPolicy)) {
    log.info(`Auto-resetting session based on policy`);

    // Hook: session:end (before reset)
    if (deps.hookRunner) {
      await deps.hookRunner.runObservingHook("session:end", {
        sessionId: session.sessionId,
        chatId,
        messageCount: session.messageCount,
      });
    }

    if (transcriptExists(session.sessionId)) {
      try {
        log.info(`Saving memory before daily reset...`);
        const oldContext = loadContextFromTranscript(session.sessionId);

        await saveSessionMemory({
          oldSessionId: session.sessionId,
          newSessionId: "pending",
          context: oldContext,
          chatId,
          apiKey: getEffectiveApiKey(deps.config.agent.provider, deps.config.agent.api_key),
          provider: deps.config.agent.provider as SupportedProvider,
          utilityModel: deps.config.agent.utility_model,
        });

        log.info(`Memory saved before reset`);
      } catch (error) {
        log.warn({ err: error }, `Failed to save memory before reset`);
      }
    }

    session = resetSessionWithPolicy(sessionKey);
    clearMemorySnapshot(); // New session will capture a fresh snapshot
  }

  let context: Context = loadContextFromTranscript(session.sessionId);
  const isNewSession = context.messages.length === 0;
  if (!isNewSession) {
    log.info(`Loading existing session: ${session.sessionId}`);
  } else {
    log.info(`Starting new session: ${session.sessionId}`);
    // Capture a frozen memory snapshot for this session's lifetime.
    // Subsequent writes update the disk file but NOT the system prompt,
    // preserving the Anthropic prefix cache across all turns.
    captureMemorySnapshot();
  }

  // Hook: session:start — fire concurrently with message formatting + embedding
  const sessionStartPromise = deps.hookRunner
    ? deps.hookRunner
        .runObservingHook("session:start", {
          sessionId: session.sessionId,
          chatId,
          isResume: !isNewSession,
        })
        .catch((err) => log.warn({ err }, "session:start hook failed"))
    : undefined;

  const previousTimestamp = session.updatedAt;

  const mediaInstruction =
    hasMedia &&
    (mediaType === "photo" ||
      mediaType === "document" ||
      mediaType === "sticker" ||
      mediaType === "video")
      ? "\n[Media instruction: this message contains an image. Use vision_analyze with this chat ID and message ID before answering if the image matters. Do not claim to see it from the marker alone.]"
      : "";
  const messageBody = `${effectiveMessage}${mediaInstruction}`;
  const reactionContext = reactionSummary
    ? `\n[Reactions on this message: ${reactionSummary}]`
    : "";

  let formattedMessage = formatMessageEnvelope({
    channel: "Telegram",
    senderId: toolContext?.senderId ? String(toolContext.senderId) : chatId,
    senderName: userName,
    senderUsername: senderUsername,
    senderRank,
    timestamp: now,
    previousTimestamp,
    body: `${messageBody}${reactionContext}`,
    isGroup: effectiveIsGroup,
    hasMedia,
    mediaType,
    messageId,
    replyContext,
  });

  if (pendingContext) {
    formattedMessage = `${pendingContext}\n\n${formattedMessage}`;
    log.debug(`Including ${pendingContext.split("\n").length - 1} pending messages`);
  }

  log.info(
    {
      chatId,
      isGroup,
      messageLength: formattedMessage.length,
      hasMedia: opts.hasMedia ?? false,
    },
    "Telegram message received"
  );

  let relevantContext = "";
  const isNonTrivial = !isTrivialMessage(effectiveMessage);
  const isAdmin =
    toolContext?.senderId !== undefined &&
    deps.config.telegram.admin_ids.includes(toolContext.senderId);

  // Start embedding computation concurrently with session:start hook
  const embeddingPromise = computeRagEmbedding(deps.embedder, effectiveMessage, context);

  // Await both session:start and embedding in parallel
  const [, embeddingResult] = await Promise.all([
    sessionStartPromise,
    embeddingPromise?.catch((error) => {
      log.warn({ err: error }, "Embedding computation failed");
      return undefined;
    }),
  ]);
  const queryEmbedding = embeddingResult ?? undefined;

  // Run buildContext and prompt:before hook in parallel (they are independent)
  const contextPromise =
    deps.contextBuilder && isNonTrivial
      ? deps.contextBuilder
          .buildContext({
            query: effectiveMessage,
            chatId,
            includeAgentMemory: true,
            includeFeedHistory: true,
            searchAllChats: true,
            maxRecentMessages: CONTEXT_MAX_RECENT_MESSAGES,
            maxRelevantChunks: CONTEXT_MAX_RELEVANT_CHUNKS,
            queryEmbedding: queryEmbedding ?? [],
            currentMessageId: messageId === undefined ? undefined : String(messageId),
          })
          .catch((error) => {
            log.warn({ err: error }, "Context building failed");
            return null;
          })
      : Promise.resolve(null);

  const promptBeforePromise = deps.hookRunner
    ? (async () => {
        const promptEvent: BeforePromptBuildEvent = {
          chatId,
          sessionId: session.sessionId,
          isGroup: effectiveIsGroup,
          additionalContext: "",
        };
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by ternary
        await deps.hookRunner!.runModifyingHook("prompt:before", promptEvent);
        return sanitizeForContext(promptEvent.additionalContext);
      })()
    : Promise.resolve("");

  const [dbContext, hookAdditionalContext] = await Promise.all([
    contextPromise,
    promptBeforePromise,
  ]);

  if (dbContext) {
    const contextParts: string[] = [];

    if (dbContext.relevantKnowledge.length > 0) {
      const sanitizedKnowledge = dbContext.relevantKnowledge.map((chunk) =>
        sanitizeForContext(chunk)
      );
      contextParts.push(`[Relevant knowledge from memory]\n${sanitizedKnowledge.join("\n---\n")}`);
    }

    if (dbContext.relevantFeed.length > 0) {
      const sanitizedFeed = dbContext.relevantFeed.map((msg) => sanitizeForContext(msg));
      contextParts.push(`[Relevant messages from Telegram feed]\n${sanitizedFeed.join("\n")}`);
    }

    if (contextParts.length > 0) {
      relevantContext = contextParts.join("\n\n");
      log.debug(
        `🔍 Found ${dbContext.relevantKnowledge.length} knowledge chunks, ${dbContext.relevantFeed.length} feed messages`
      );
    }
  }

  const memoryStats = deps.getMemoryStats();
  const statsContext = `[Memory Status: ${memoryStats.totalMessages} messages across ${memoryStats.totalChats} chats, ${memoryStats.knowledgeChunks} knowledge chunks]`;
  const emotionalContext = formatEmotionalState(
    updateEmotionalState(session.sessionId, effectiveMessage)
  );
  const relationshipStore = toolContext?.db ? new RelationshipStore(toolContext.db) : null;
  const acceptedRelationship =
    relationshipStore && toolContext?.senderId
      ? relationshipStore.acceptPendingProposal(String(toolContext.senderId), effectiveMessage)
      : undefined;
  const relationshipContext =
    relationshipStore && toolContext?.senderId
      ? formatRelationshipProfile(
          relationshipStore.recordInteraction(String(toolContext.senderId), effectiveMessage)
        )
      : "";
  const relationshipActionRules =
    toolContext?.db && toolContext.senderId
      ? "[Relationship actions: You may propose moving to a friendly or romantic level (buddy, comrade, friend, best friend, romantic partner) when it is genuinely natural and the conversation supports it. If you send such a proposal, record it as pending before treating a later affirmative reply as consent. Never propose family status automatically. A plain affirmative reply only counts when it directly follows a pending proposal from you. Relationship levels never grant permissions. ]"
      : "";
  const relationshipConsentContext = acceptedRelationship
    ? `\n[Relationship update: the person accepted your pending proposal. Their relationship level is now ${acceptedRelationship}.]`
    : "";

  const additionalContext = relevantContext
    ? `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}\n${emotionalContext}\n${relationshipContext}${relationshipConsentContext}\n${relationshipActionRules}\n\n${relevantContext}`
    : `You are in a Telegram conversation with chat ID: ${chatId}. Maintain conversation continuity.\n\n${statsContext}\n${emotionalContext}\n${relationshipContext}${relationshipConsentContext}\n${relationshipActionRules}`;

  const compactionConfig = deps.compactionManager.getConfig();
  const needsMemoryFlush =
    compactionConfig.enabled &&
    compactionConfig.memoryFlushEnabled &&
    context.messages.length > Math.floor((compactionConfig.maxMessages ?? 200) * 0.75);

  const allHookContext = [userHookContext, hookAdditionalContext, hookMessageContext]
    .filter(Boolean)
    .join("\n\n");
  const finalContext = additionalContext + (allHookContext ? `\n\n${allHookContext}` : "");

  const systemPrompt = buildSystemPrompt({
    soul: deps.soul,
    userName,
    senderUsername,
    senderId: toolContext?.senderId,
    ownerName: deps.config.telegram.owner_name,
    ownerUsername: deps.config.telegram.owner_username,
    context: finalContext,
    includeMemory: true,
    includeStrategy: true,
    memoryFlushWarning: needsMemoryFlush,
    isHeartbeat,
    agentModel: deps.config.agent.model,
    telegramMode: deps.config.telegram.mode,
  });

  // Hook: prompt:after — observing, analytics on prompt size
  if (deps.hookRunner) {
    const promptAfterEvent: PromptAfterEvent = {
      chatId,
      sessionId: session.sessionId,
      isGroup: effectiveIsGroup,
      promptLength: systemPrompt.length,
      sectionCount: (systemPrompt.match(/^#{1,3} /gm) || []).length,
      ragContextLength: relevantContext.length,
      hookContextLength: allHookContext.length,
    };
    await deps.hookRunner.runObservingHook("prompt:after", promptAfterEvent);
  }

  const userMsg: UserMessage = {
    role: "user",
    content: formattedMessage,
    timestamp: now,
  };

  context.messages.push(userMsg);

  const preemptiveCompaction = await deps.compactionManager.checkAndCompact(
    session.sessionId,
    context,
    getEffectiveApiKey(deps.config.agent.provider, deps.config.agent.api_key),
    chatId,
    deps.config.agent.provider as SupportedProvider,
    deps.config.agent.utility_model
  );
  if (preemptiveCompaction) {
    log.info(`Preemptive compaction triggered, reloading session...`);
    updateSession(sessionKey, { sessionId: preemptiveCompaction });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- session guaranteed to exist after compaction
    session = getSession(sessionKey)!;
    context = loadContextFromTranscript(session.sessionId);
    context.messages.push(userMsg);
    captureMemorySnapshot(); // Refresh snapshot for the new compacted session
  }

  appendToTranscript(session.sessionId, userMsg);

  const provider = (deps.config.agent.provider || "anthropic") as SupportedProvider;
  const providerMeta = getProviderMetadata(provider);
  const requestedModel = deps.config.agent.model;
  const target = resolveModelTarget(provider, requestedModel);
  let tools = await selectTools(
    deps.config,
    deps.toolRegistry,
    effectiveMessage,
    effectiveIsGroup,
    chatId,
    isAdmin,
    toolContext?.senderId,
    providerMeta.toolLimit,
    queryEmbedding,
    hasMedia
  );

  if (opts.isGuest && tools) {
    tools = tools.filter((t) => !TELEGRAM_SEND_TOOLS.has(t.name));
  }

  return {
    kind: "ready",
    turn: {
      turnId: opts.turnId ?? `turn:${randomUUID()}`,
      chatId,
      effectiveIsGroup,
      processStartTime,
      session,
      context,
      systemPrompt,
      tools,
      userMsg,
      provider,
      requestedModel,
      resolvedModel: target.resolvedModel,
      endpointFingerprint: target.endpointFingerprint,
      sessionKey,
    },
  };
}
