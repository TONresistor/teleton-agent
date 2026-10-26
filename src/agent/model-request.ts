import {
  clampThinkingLevel,
  hasApi,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreamOptions,
  type Tool,
} from "@earendil-works/pi-ai/compat";
import type { AgentConfig } from "../config/schema.js";
import type { SupportedProvider } from "../config/providers.js";
import { getCodexApiKey } from "../providers/codex-credentials.js";
import { getGrokBuildApiKey } from "../providers/grok-build-credentials.js";
import { getProviderModel, isCustomOpenRouterModel } from "../providers/model-resolver.js";
import { createOpenRouterUsageTracker } from "../providers/openrouter-usage.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { sanitizeToolsForGemini } from "./schema-sanitizer.js";

export interface ModelRequestOptions {
  systemPrompt?: string;
  context: Context;
  sessionId?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PreparedModelRequest {
  provider: SupportedProvider;
  model: Model<Api>;
  context: Context;
  options: ProviderStreamOptions;
  finalizeUsage?: (message: AssistantMessage) => void;
}

/** Resolve the effective API key for a provider (local/gocoon need no real key). */
export function getEffectiveApiKey(provider: string, rawKey: string): string {
  if (provider === "local") return "local";
  if (provider === "gocoon") return "gocoon";
  if (provider === "codex") return getCodexApiKey(rawKey);
  if (provider === "grok-build") return getGrokBuildApiKey();
  return rawKey;
}

const GOOGLE_MODELS_WITHOUT_SAMPLING_PARAMS = new Set([
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
]);

function modelSupportsTemperature(provider: SupportedProvider, model: Model<Api>): boolean {
  if (provider === "codex" || provider === "grok-build") return false;
  // Responses reasoning models reject sampling controls. Their capabilities come
  // from the catalog, including models introduced after this release.
  if (provider === "openai" && model.reasoning) return false;
  if (hasApi(model, "anthropic-messages")) {
    return (
      model.compat?.supportsTemperature !== false &&
      model.compat?.forceAdaptiveThinking !== true &&
      model.compat?.supportsMidConvoEffort !== true
    );
  }
  if (provider === "openrouter") {
    if (model.id.startsWith("openai/") && model.reasoning) return false;
    // The OpenRouter catalog does not yet expose sampling compatibility for
    // these models, so retain the verified gateway exceptions.
    return ![
      "anthropic/claude-fable-5.1",
      "anthropic/claude-opus-5.5",
      "google/gemini-3.8-flash",
    ].includes(model.id);
  }
  if (provider === "google" && GOOGLE_MODELS_WITHOUT_SAMPLING_PARAMS.has(model.id)) return false;
  return true;
}

function getCacheRetention(provider: SupportedProvider): "none" | "long" {
  return provider === "grok-build" || provider === "groq" ? "none" : "long";
}

function getReasoningOptions(
  provider: SupportedProvider,
  model: Model<Api>,
  reasoningEffort: AgentConfig["reasoning_effort"]
): Record<string, unknown> {
  const requiresZaiThinking = provider === "zai" && model.thinkingLevelMap?.off === null;
  const adaptiveMiniMax =
    provider === "minimax" &&
    hasApi(model, "anthropic-messages") &&
    model.compat?.forceAdaptiveThinking === true;
  if (
    (provider !== "codex" &&
      provider !== "openai" &&
      provider !== "xai" &&
      !adaptiveMiniMax &&
      !requiresZaiThinking) ||
    !model.reasoning
  ) {
    return {};
  }
  const level = clampThinkingLevel(model, reasoningEffort === "none" ? "off" : reasoningEffort);
  const mapped = model.thinkingLevelMap?.[level];
  if (adaptiveMiniMax) return { effort: mapped ?? level };
  return { reasoningEffort: mapped ?? (level === "off" ? "none" : level) };
}

function prepareTools(tools: Tool[] | undefined): Tool[] | undefined {
  if (!tools) return tools;

  return tools.map((tool) => {
    if (!TELEGRAM_SEND_TOOLS.has(tool.name)) return tool;
    if (tool.name === "telegram_send_message") {
      return {
        ...tool,
        description:
          `${tool.description} This action sends immediately. ` +
          "For the current reply, return normal assistant text unless native Rich Message structure is required. " +
          "When rich structure is required, call this tool once and do not return a duplicate confirmation. " +
          "Use it normally for intentional messages to another chat.",
      };
    }
    return {
      ...tool,
      description:
        `${tool.description} This action sends immediately. ` +
        "Do not use this tool to reply to the current inbound message or for progress updates; " +
        "return normal assistant text instead, which Teleton delivers automatically. " +
        "Use it for intentional separate Telegram messages.",
    };
  });
}

function getProviderPayloadOptions(provider: SupportedProvider): Record<string, unknown> {
  if (provider !== "grok-build") return {};

  return {
    onPayload: (payload: unknown) => ({
      ...(payload && typeof payload === "object" ? payload : {}),
      parallel_tool_calls: false,
    }),
  };
}

export function prepareModelRequest(
  config: AgentConfig,
  request: ModelRequestOptions
): PreparedModelRequest {
  const provider = (config.provider || "anthropic") as SupportedProvider;
  const model = getProviderModel(provider, config.model, config.base_url);
  const preparedTools = prepareTools(request.tools);
  const tools =
    provider === "google" && preparedTools ? sanitizeToolsForGemini(preparedTools) : preparedTools;
  const context: Context = {
    ...request.context,
    systemPrompt: request.systemPrompt || request.context.systemPrompt || "",
    tools,
  };
  const temperature = request.temperature ?? config.temperature;
  const usageTracker =
    provider === "openrouter" && model.api === "openai-completions"
      ? createOpenRouterUsageTracker(isCustomOpenRouterModel(model))
      : undefined;

  return {
    provider,
    model,
    context,
    finalizeUsage: usageTracker?.apply,
    options: {
      identity: {
        userAgent: { custom: "teleton-agent" },
        attribution: {
          name: "teleton-agent",
          url: "https://github.com/TONresistor/teleton-agent",
        },
      },
      ...(usageTracker && { fetch: usageTracker.fetch }),
      apiKey: getEffectiveApiKey(provider, config.api_key),
      maxTokens: request.maxTokens ?? config.max_tokens,
      ...(!isCustomOpenRouterModel(model) &&
        modelSupportsTemperature(provider, model) && { temperature }),
      sessionId: request.sessionId,
      cacheRetention: getCacheRetention(provider),
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      ...getReasoningOptions(provider, model, config.reasoning_effort),
      ...(hasApi(model, "anthropic-messages") &&
        model.compat?.forceAdaptiveThinking === true && { thinkingEnabled: true }),
      ...getProviderPayloadOptions(provider),
    } as ProviderStreamOptions,
  };
}
