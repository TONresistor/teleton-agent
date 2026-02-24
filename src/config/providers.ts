export type SupportedProvider =
  | "anthropic"
  | "claude-code"
  | "openai"
  | "google"
  | "xai"
  | "groq"
  | "openrouter"
  | "moonshot"
  | "mistral"
  | "cocoon"
  | "local";

export interface ProviderMetadata {
  id: SupportedProvider;
  displayName: string;
  envVar: string;
  keyPrefix: string | null;
  keyHint: string;
  consoleUrl: string;
  defaultModel: string;
  utilityModel: string;
  toolLimit: number | null;
  piAiProvider: string;
}

const PROVIDER_REGISTRY: Record<SupportedProvider, ProviderMetadata> = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    keyHint: "sk-ant-api03-...",
    consoleUrl: "https://console.anthropic.com/",
    defaultModel: "claude-opus-4-6",
    utilityModel: "claude-3-5-haiku-20241022",
    toolLimit: null,
    piAiProvider: "anthropic",
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code (Auto)",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    keyHint: "Auto-detected from Claude Code",
    consoleUrl: "https://console.anthropic.com/",
    defaultModel: "claude-opus-4-6",
    utilityModel: "claude-3-5-haiku-20241022",
    toolLimit: null,
    piAiProvider: "anthropic",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI (GPT-4o)",
    envVar: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-proj-...",
    consoleUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o",
    utilityModel: "gpt-4o-mini",
    toolLimit: 128,
    piAiProvider: "openai",
  },
  google: {
    id: "google",
    displayName: "Google (Gemini)",
    envVar: "GOOGLE_API_KEY",
    keyPrefix: null,
    keyHint: "AIza...",
    consoleUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-flash",
    utilityModel: "gemini-2.0-flash-lite",
    toolLimit: 128,
    piAiProvider: "google",
  },
  xai: {
    id: "xai",
    displayName: "xAI (Grok)",
    envVar: "XAI_API_KEY",
    keyPrefix: "xai-",
    keyHint: "xai-...",
    consoleUrl: "https://console.x.ai/",
    defaultModel: "grok-3",
    utilityModel: "grok-3-mini-fast",
    toolLimit: 128,
    piAiProvider: "xai",
  },
  groq: {
    id: "groq",
    displayName: "Groq",
    envVar: "GROQ_API_KEY",
    keyPrefix: "gsk_",
    keyHint: "gsk_...",
    consoleUrl: "https://console.groq.com/keys",
    defaultModel: "llama-3.3-70b-versatile",
    utilityModel: "llama-3.1-8b-instant",
    toolLimit: 128,
    piAiProvider: "groq",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    keyPrefix: "sk-or-",
    keyHint: "sk-or-v1-...",
    consoleUrl: "https://openrouter.ai/keys",
    defaultModel: "anthropic/claude-opus-4.5",
    utilityModel: "google/gemini-2.5-flash-lite",
    toolLimit: 128,
    piAiProvider: "openrouter",
  },
  moonshot: {
    id: "moonshot",
    displayName: "Moonshot (Kimi K2.5)",
    envVar: "MOONSHOT_API_KEY",
    keyPrefix: "sk-",
    keyHint: "sk-...",
    consoleUrl: "https://platform.moonshot.ai/",
    defaultModel: "kimi-k2.5",
    utilityModel: "kimi-k2.5",
    toolLimit: 128,
    piAiProvider: "moonshot",
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral AI",
    envVar: "MISTRAL_API_KEY",
    keyPrefix: null,
    keyHint: "...",
    consoleUrl: "https://console.mistral.ai/api-keys",
    defaultModel: "devstral-small-2507",
    utilityModel: "ministral-8b-latest",
    toolLimit: 128,
    piAiProvider: "mistral",
  },
  cocoon: {
    id: "cocoon",
    displayName: "Cocoon Network (Decentralized)",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key needed — pays in TON",
    consoleUrl: "https://cocoon.network",
    defaultModel: "Qwen/Qwen3-32B",
    utilityModel: "Qwen/Qwen3-32B",
    toolLimit: 128,
    piAiProvider: "cocoon",
  },
  local: {
    id: "local",
    displayName: "Local (Ollama, vLLM, LM Studio...)",
    envVar: "",
    keyPrefix: null,
    keyHint: "No API key needed",
    consoleUrl: "",
    defaultModel: "auto",
    utilityModel: "auto",
    toolLimit: 128,
    piAiProvider: "local",
  },
};

export function getProviderMetadata(provider: SupportedProvider): ProviderMetadata {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return meta;
}

export function getSupportedProviders(): ProviderMetadata[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function validateApiKeyFormat(provider: SupportedProvider, key: string): string | undefined {
  const meta = PROVIDER_REGISTRY[provider];
  if (!meta) return `Unknown provider: ${provider}`;
  if (provider === "cocoon" || provider === "local" || provider === "claude-code") return undefined; // No API key needed (claude-code auto-detects)
  if (!key || key.trim().length === 0) return "API key is required";
  if (meta.keyPrefix && !key.startsWith(meta.keyPrefix)) {
    return `Invalid format (should start with ${meta.keyPrefix})`;
  }
  return undefined;
}

export { PROVIDER_REGISTRY };
