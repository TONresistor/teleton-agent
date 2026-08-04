export interface ProviderMetadata {
  id: string;
  displayName: string;
  credentialMode: "api-key" | "cli-auto" | "none";
  envVar: string;
  keyPrefix: string | null;
  keyHint: string;
  consoleUrl: string;
  defaultModel: string;
  utilityModel: string;
  toolLimit: number | null;
  piAiProvider: string;
}

const PROVIDER_REGISTRY = {
  codex: {
    id: "codex",
    displayName: "Codex (Auto)",
    credentialMode: "cli-auto",
    envVar: "OPENAI_API_KEY",
    keyPrefix: null,
    keyHint: "Auto-detected from Codex CLI",
    consoleUrl: "https://platform.openai.com/",
    defaultModel: "gpt-5.6-terra",
    utilityModel: "gpt-5.4-mini",
    toolLimit: 128,
    piAiProvider: "openai-codex",
  },
  "grok-build": {
    id: "grok-build",
    displayName: "Grok Build (Auto)",
    credentialMode: "cli-auto",
    envVar: "",
    keyPrefix: null,
    keyHint: "Auto-detected from Grok CLI",
    consoleUrl: "https://x.ai/cli",
    defaultModel: "grok-4.5",
    utilityModel: "grok-4.5",
    toolLimit: 128,
    piAiProvider: "grok-build",
  },
  zai: {
    id: "zai",
    displayName: "ZAI (Zhipu)",
    credentialMode: "api-key",
    envVar: "ZAI_API_KEY",
    keyPrefix: null,
    keyHint: "...",
    consoleUrl: "https://z.ai/manage-apikey/apikey-list",
    defaultModel: "glm-5.2",
    utilityModel: "glm-5-turbo",
    toolLimit: 128,
    piAiProvider: "zai",
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    credentialMode: "api-key",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    keyHint: "sk-ant-api03-...",
    consoleUrl: "https://console.anthropic.com/",
    defaultModel: "claude-haiku-4-5-20251001",
    utilityModel: "claude-haiku-4-5-20251001",
    toolLimit: null,
    piAiProvider: "anthropic",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    credentialMode: "api-key",
    envVar: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-proj-...",
    consoleUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5.6-terra",
    utilityModel: "gpt-5.4-nano",
    toolLimit: 128,
    piAiProvider: "openai",
  },
  google: {
    id: "google",
    displayName: "Google (Gemini)",
    credentialMode: "api-key",
    envVar: "GOOGLE_API_KEY",
    keyPrefix: null,
    keyHint: "AIza...",
    consoleUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-3.6-flash",
    utilityModel: "gemini-3.5-flash-lite",
    toolLimit: 128,
    piAiProvider: "google",
  },
  xai: {
    id: "xai",
    displayName: "xAI (Grok)",
    credentialMode: "api-key",
    envVar: "XAI_API_KEY",
    keyPrefix: "xai-",
    keyHint: "xai-...",
    consoleUrl: "https://console.x.ai/",
    defaultModel: "grok-4.5",
    utilityModel: "grok-4.3",
    toolLimit: 128,
    piAiProvider: "xai",
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    credentialMode: "api-key",
    envVar: "GROQ_API_KEY",
    keyPrefix: "gsk_",
    keyHint: "gsk_...",
    consoleUrl: "https://console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
    utilityModel: "openai/gpt-oss-20b",
    toolLimit: 128,
    piAiProvider: "groq",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    credentialMode: "api-key",
    envVar: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    keyHint: "sk-or-v1-...",
    consoleUrl: "https://openrouter.ai/keys",
    defaultModel: "anthropic/claude-opus-5",
    utilityModel: "google/gemini-3.5-flash-lite",
    toolLimit: 128,
    piAiProvider: "openrouter",
  },
  moonshot: {
    id: "moonshot",
    displayName: "Moonshot (Kimi)",
    credentialMode: "api-key",
    envVar: "MOONSHOT_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-...",
    consoleUrl: "https://platform.moonshot.ai/",
    defaultModel: "kimi-for-coding",
    utilityModel: "kimi-for-coding",
    toolLimit: 128,
    piAiProvider: "kimi-coding",
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral AI",
    credentialMode: "api-key",
    envVar: "MISTRAL_API_KEY",
    keyPrefix: null,
    keyHint: "...",
    consoleUrl: "https://console.mistral.ai/api-keys",
    defaultModel: "mistral-medium-latest",
    utilityModel: "mistral-small-2603",
    toolLimit: 128,
    piAiProvider: "mistral",
  },
  cerebras: {
    id: "cerebras",
    displayName: "Cerebras",
    credentialMode: "api-key",
    envVar: "CEREBRAS_API_KEY",
    keyPrefix: "csk-",
    keyHint: "csk-...",
    consoleUrl: "https://cloud.cerebras.ai/",
    defaultModel: "gpt-oss-120b",
    utilityModel: "gemma-4-31b",
    toolLimit: 128,
    piAiProvider: "cerebras",
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax",
    credentialMode: "api-key",
    envVar: "MINIMAX_API_KEY",
    keyPrefix: null,
    keyHint: "Save your key — shown only once!",
    consoleUrl: "https://platform.minimax.io/",
    defaultModel: "MiniMax-M3",
    utilityModel: "MiniMax-M3",
    toolLimit: 128,
    piAiProvider: "minimax",
  },
  huggingface: {
    id: "huggingface",
    displayName: "HuggingFace",
    credentialMode: "api-key",
    envVar: "HF_TOKEN",
    keyPrefix: "hf_",
    keyHint: "hf_...",
    consoleUrl: "https://huggingface.co/settings/tokens",
    defaultModel: "deepseek-ai/DeepSeek-V4-Pro",
    utilityModel: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    toolLimit: 128,
    piAiProvider: "huggingface",
  },
  gocoon: {
    id: "gocoon",
    displayName: "Gocoon (Decentralized, TON)",
    credentialMode: "none",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key, pays in TON",
    consoleUrl: "https://github.com/TONresistor/gocoon",
    defaultModel: "Qwen/Qwen3-32B",
    utilityModel: "Qwen/Qwen3-32B",
    toolLimit: 128,
    piAiProvider: "gocoon",
  },
  local: {
    id: "local",
    displayName: "Local (Ollama, vLLM, LM Studio...)",
    credentialMode: "none",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key needed",
    consoleUrl: "",
    defaultModel: "auto",
    utilityModel: "auto",
    toolLimit: 128,
    piAiProvider: "local",
  },
} as const satisfies Record<string, ProviderMetadata>;

export type SupportedProvider = keyof typeof PROVIDER_REGISTRY;
type RegisteredProviderMetadata = (typeof PROVIDER_REGISTRY)[SupportedProvider];

export function getProviderMetadata(provider: SupportedProvider): RegisteredProviderMetadata {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return meta;
}

export function getSupportedProviders(): RegisteredProviderMetadata[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function providerNeedsApiKey(provider: SupportedProvider): boolean {
  return getProviderMetadata(provider).credentialMode === "api-key";
}

/**
 * Provider ids as a non-empty tuple, derived from the single registry so the
 * Zod `agent.provider` enum stays in sync with PROVIDER_REGISTRY (no 3rd copy).
 */
export const SUPPORTED_PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY) as [
  SupportedProvider,
  ...SupportedProvider[],
];

export function validateApiKeyFormat(provider: SupportedProvider, key: string): string | undefined {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) return `Unknown provider: ${provider}`;
  if (!providerNeedsApiKey(provider)) return undefined;
  if (!key || key.trim().length === 0) return "API key is required";
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return `Invalid format (should start with ${meta.keyPrefix})`;
  }
  return undefined;
}

export { PROVIDER_REGISTRY };
