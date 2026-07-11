import type {
  Api,
  Context,
  Model,
  ProviderStreamOptions,
  Tool,
} from "@earendil-works/pi-ai/compat";
import type { AgentConfig } from "../config/schema.js";
import type { SupportedProvider } from "../config/providers.js";
import { getCodexApiKey } from "../providers/codex-credentials.js";
import { getGrokBuildApiKey } from "../providers/grok-build-credentials.js";
import { getProviderModel } from "../providers/model-resolver.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { sanitizeToolsForGemini } from "./schema-sanitizer.js";

export interface ModelRequestOptions {
  systemPrompt?: string;
  context: Context;
  sessionId?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Tool[];
}

export interface PreparedModelRequest {
  provider: SupportedProvider;
  model: Model<Api>;
  context: Context;
  options: ProviderStreamOptions;
}

/** Resolve the effective API key for a provider (local/gocoon need no real key). */
export function getEffectiveApiKey(provider: string, rawKey: string): string {
  if (provider === "local") return "local";
  if (provider === "gocoon") return "gocoon";
  if (provider === "codex") return getCodexApiKey(rawKey);
  if (provider === "grok-build") return getGrokBuildApiKey();
  return rawKey;
}

function providerSupportsTemperature(provider: SupportedProvider): boolean {
  return provider !== "codex" && provider !== "grok-build";
}

function getCacheRetention(provider: SupportedProvider): "none" | "long" {
  return provider === "grok-build" ? "none" : "long";
}

function prepareTools(tools: Tool[] | undefined): Tool[] | undefined {
  if (!tools) return tools;

  return tools.map((tool) =>
    TELEGRAM_SEND_TOOLS.has(tool.name)
      ? {
          ...tool,
          description:
            `${tool.description} This action sends immediately. ` +
            "Do not use this tool to reply to the current inbound message or for progress updates; " +
            "return normal assistant text instead, which Teleton delivers automatically. " +
            "Use it for intentional separate Telegram messages.",
        }
      : tool
  );
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
  const model = getProviderModel(provider, config.model);
  const preparedTools = prepareTools(request.tools);
  const tools =
    provider === "google" && preparedTools ? sanitizeToolsForGemini(preparedTools) : preparedTools;
  const context: Context = {
    ...request.context,
    systemPrompt: request.systemPrompt || request.context.systemPrompt || "",
    tools,
  };
  const temperature = request.temperature ?? config.temperature;

  return {
    provider,
    model,
    context,
    options: {
      apiKey: getEffectiveApiKey(provider, config.api_key),
      maxTokens: request.maxTokens ?? config.max_tokens,
      ...(providerSupportsTemperature(provider) && { temperature }),
      sessionId: request.sessionId,
      cacheRetention: getCacheRetention(provider),
      ...getProviderPayloadOptions(provider),
    } as ProviderStreamOptions,
  };
}
