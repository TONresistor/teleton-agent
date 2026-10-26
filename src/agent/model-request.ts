import { createRetryAfterTracker } from "../utils/fetch.js";
import { thinkingBudgetForLevel } from "@earendil-works/pi-ai/api/simple-options";
import {
  usesGoogleThinkingLevel,
  resolveGoogleThinkingLevel,
  toGoogleThinkingLevel,
} from "@earendil-works/pi-ai/api/google-shared";
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
import {
  getProviderModel,
  getOutputTokenBudget,
  isCustomOpenRouterModel,
} from "../providers/model-resolver.js";
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
  retryAfterMs?: () => number | undefined;
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
  reasoningEffort: AgentConfig["reasoning_effort"],
  maxTokens: number
): Record<string, unknown> {
  if (!model.reasoning) return {};
  const requiresZaiThinking = provider === "zai" && model.thinkingLevelMap?.off === null;
  const adaptiveThinking =
    hasApi(model, "anthropic-messages") && model.compat?.forceAdaptiveThinking === true;
  const openAiThinking =
    hasApi(model, "openai-responses") ||
    hasApi(model, "openai-codex-responses") ||
    (hasApi(model, "openai-completions") &&
      (model.compat?.supportsReasoningEffort !== false || requiresZaiThinking));
  const level = clampThinkingLevel(model, reasoningEffort === "none" ? "off" : reasoningEffort);
  if (hasApi(model, "anthropic-messages") && !adaptiveThinking) {
    if (level === "off") return { thinkingEnabled: false };
    const budget = Math.min(thinkingBudgetForLevel(level), Math.max(0, maxTokens - 1024));
    if (budget < 1024) {
      if (model.thinkingLevelMap?.off === null)
        throw new Error("Output budget cannot fit required thinking and an answer");
      return { thinkingEnabled: false };
    }
    return { thinkingEnabled: true, thinkingBudgetTokens: budget };
  }
  if (hasApi(model, "google-generative-ai")) {
    if (level === "off") return { thinking: { enabled: false } };
    if (usesGoogleThinkingLevel(model))
      return {
        thinking: {
          enabled: true,
          level: toGoogleThinkingLevel(resolveGoogleThinkingLevel(model, level)),
        },
      };
    const minimum = model.id.includes("flash-lite") ? 512 : 128;
    const budget = Math.min(thinkingBudgetForLevel(level), Math.max(0, maxTokens - 1024));
    return {
      thinking: { enabled: budget >= minimum, ...(budget >= minimum && { budgetTokens: budget }) },
    };
  }
  if (!adaptiveThinking && !openAiThinking) return {};
  const mapped = model.thinkingLevelMap?.[level];
  if (adaptiveThinking) {
    return level === "off"
      ? { thinkingEnabled: false }
      : { thinkingEnabled: true, effort: mapped ?? (level === "minimal" ? "low" : level) };
  }
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
  const maxTokens = getOutputTokenBudget(model, context, request.maxTokens ?? config.max_tokens);
  const reasoningOptions = getReasoningOptions(provider, model, config.reasoning_effort, maxTokens);
  const usageTracker =
    provider === "openrouter" && model.api === "openai-completions"
      ? createOpenRouterUsageTracker(isCustomOpenRouterModel(model))
      : undefined;

  const supportsCustomFetch =
    !hasApi(model, "google-generative-ai") && !hasApi(model, "google-vertex");
  const retryTracker = supportsCustomFetch
    ? createRetryAfterTracker(usageTracker?.fetch)
    : undefined;
  return {
    provider,
    model,
    context,
    finalizeUsage: usageTracker?.apply,
    retryAfterMs: retryTracker?.retryAfterMs,
    options: {
      identity: {
        userAgent: { custom: "teleton-agent" },
        attribution: {
          name: "teleton-agent",
          url: "https://github.com/TONresistor/teleton-agent",
        },
      },
      ...(retryTracker && { fetch: retryTracker.fetch }),
      maxRetries: 0,
      apiKey: getEffectiveApiKey(provider, config.api_key),
      maxTokens,
      ...(!isCustomOpenRouterModel(model) &&
        modelSupportsTemperature(provider, model) &&
        reasoningOptions.thinkingEnabled !== true && { temperature }),
      sessionId: request.sessionId,
      cacheRetention: getCacheRetention(provider),
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      ...reasoningOptions,
      ...getProviderPayloadOptions(provider),
    } as ProviderStreamOptions,
  };
}
