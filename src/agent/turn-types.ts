import type { Context, Tool as PiAiTool, UserMessage } from "@earendil-works/pi-ai";
import type { SupportedProvider } from "../config/providers.js";
import type { SessionEntry } from "../session/store.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { ChatResponse } from "./client.js";
import type { UsageAccumulator } from "./runtime-utils.js";
import type { CompletedToolCall } from "./telegram-send-state.js";
import type { ToolContext } from "./tools/types.js";

export interface ProcessMessageOptions {
  chatId: string;
  userMessage: string;
  userName?: string;
  timestamp?: number;
  isGroup?: boolean;
  pendingContext?: string | null;
  toolContext?: Omit<ToolContext, "chatId" | "isGroup">;
  senderUsername?: string;
  senderRank?: string;
  hasMedia?: boolean;
  mediaType?: string;
  messageId?: number;
  replyContext?: { senderName?: string; text: string; isAgent?: boolean };
  reactionSummary?: string;
  isHeartbeat?: boolean;
  isGuest?: boolean;
  streamToChat?: { chatId: string; bridge: ITelegramBridge; mode: "all" | "replace" | "off" };
  /** Stable inbound-event identifier used for idempotent action execution. */
  turnId?: string;
  /** Optional conversation-state key when delivery chat and session identity differ. */
  sessionKey?: string;
}

export interface AgentResponse {
  content: string;
  toolCalls?: CompletedToolCall[];
  streamed?: boolean;
}

export interface TurnContext {
  turnId: string;
  chatId: string;
  effectiveIsGroup: boolean;
  processStartTime: number;
  session: SessionEntry;
  context: Context;
  systemPrompt: string;
  tools: PiAiTool[] | undefined;
  userMsg: UserMessage;
  provider: SupportedProvider;
  requestedModel: string;
  resolvedModel: string;
  endpointFingerprint: string;
  sessionKey: string;
}

export type TurnContextResult =
  | { kind: "ready"; turn: TurnContext }
  | { kind: "early"; response: AgentResponse };

export interface LoopResult {
  finalResponse: ChatResponse | null;
  session: SessionEntry;
  context: Context;
  totalToolCalls: CompletedToolCall[];
  accumulatedTexts: string[];
  accumulatedUsage: UsageAccumulator;
  wasStreamed: boolean;
  iterations: number;
  stopReason: string;
  activeProvider: SupportedProvider;
  activeModel: string;
  forcedContent?: string;
}
