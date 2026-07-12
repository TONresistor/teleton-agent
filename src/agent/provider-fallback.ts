import type { AgentConfig } from "../config/schema.js";
import type { SupportedProvider } from "../config/providers.js";
import { classifyLlmError } from "./runtime-utils.js";

export interface ResolvedProviderFallback {
  provider: SupportedProvider;
  config: AgentConfig;
  nextIndex: number;
}

export function resolveProviderFallback(
  primary: AgentConfig,
  fallbackIndex: number,
  errorMessage: string,
  actionAlreadyAttempted: boolean
): ResolvedProviderFallback | null {
  const errorClass = classifyLlmError(errorMessage);
  const fallback = primary.fallbacks[fallbackIndex];
  if (
    !fallback ||
    actionAlreadyAttempted ||
    (errorClass.kind !== "rate_limit" && errorClass.kind !== "server_error")
  ) {
    return null;
  }

  return {
    provider: fallback.provider,
    nextIndex: fallbackIndex + 1,
    config: {
      ...primary,
      provider: fallback.provider,
      model: fallback.model,
      api_key: fallback.api_key ?? (fallback.provider === primary.provider ? primary.api_key : ""),
      base_url:
        fallback.base_url ??
        (fallback.provider === primary.provider ? primary.base_url : undefined),
      fallbacks: [],
    },
  };
}
