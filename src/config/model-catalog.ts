/**
 * Shared model catalog used by WebUI setup, CLI onboard, and config routes.
 * To add a model, add it here — it will appear in all UIs automatically.
 * Models must exist in pi-ai's registry or the additional model definitions.
 */

export interface ModelOption {
  value: string;
  name: string;
  description: string;
}

interface ModelGate {
  enabled: () => boolean;
  disabledMessage: string;
}

interface CatalogModelOption extends ModelOption {
  gate?: ModelGate;
}

const MODEL_OPTIONS: Record<string, CatalogModelOption[]> = {
  anthropic: [
    {
      value: "claude-fable-5-1",
      name: "Claude Fable 5.1",
      description: "Advanced agentic coding, reasoning, vision, 1M context",
    },
    {
      value: "claude-fable-5",
      name: "Claude Fable 5",
      description: "Highest capability, reasoning, vision, 1M context",
    },
    {
      value: "claude-opus-5",
      name: "Claude Opus 5",
      description: "Complex agents and coding, reasoning, vision, 1M context",
    },
    {
      value: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      description: "Balanced speed and intelligence, reasoning, vision, 1M context",
    },
    {
      value: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      description: "High-capability reasoning and vision, 1M context",
    },
    {
      value: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      description: "Reasoning and vision, 1M context",
    },
    {
      value: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      description: "Reasoning and vision, 1M context",
    },
    {
      value: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      description: "Reasoning and vision, 200K context",
    },
    {
      value: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "Balanced reasoning and vision, 1M context",
    },
    {
      value: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fast reasoning and vision, 200K context",
    },
  ],
  openai: [
    {
      value: "gpt-6-astra",
      name: "GPT-6 Astra",
      description: "Advanced reasoning and coding, vision, 272K effective context",
    },
    {
      value: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "Frontier reasoning and coding, vision, 272K effective context",
    },
    {
      value: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      description: "Balanced reasoning and cost, vision, 272K effective context",
    },
    {
      value: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      description: "Fast and cost-efficient, vision, 272K effective context",
    },
    {
      value: "gpt-5.5",
      name: "GPT-5.5",
      description: "Frontier reasoning and vision, 272K effective context",
    },
    {
      value: "gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      description: "Extended reasoning and vision, 1M context",
    },
    {
      value: "gpt-5.4",
      name: "GPT-5.4",
      description: "Reasoning and vision, 272K effective context",
    },
    {
      value: "gpt-5.4-pro",
      name: "GPT-5.4 Pro",
      description: "Extended reasoning and vision, 1M context",
    },
    {
      value: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      description: "Efficient reasoning and vision, 400K context",
    },
    {
      value: "gpt-5.4-nano",
      name: "GPT-5.4 Nano",
      description: "High-volume reasoning, vision, 400K context",
    },
    { value: "gpt-4o", name: "GPT-4o", description: "Balanced multimodal model, 128K context" },
    { value: "gpt-4.1", name: "GPT-4.1", description: "General-purpose model, 1M context" },
    {
      value: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      description: "Efficient general-purpose model, 1M context",
    },
  ],
  "openai-codex": [
    {
      value: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      description: "Balanced agentic coding model, 272K context",
    },
    {
      value: "gpt-6-astra",
      name: "GPT-6 Astra",
      description: "Advanced agentic coding, reasoning, vision, 272K context",
    },
    {
      value: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "Frontier agentic coding model, 272K context",
    },
    {
      value: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      description: "Fast and affordable agentic coding model, 272K context",
    },
    { value: "gpt-5.5", name: "GPT-5.5", description: "Reasoning, 272K context" },
    { value: "gpt-5.4", name: "GPT-5.4", description: "Reasoning, 272K context" },
    { value: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Fast & cheap, reasoning" },
    {
      value: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      description: "Coding, preview, free",
    },
  ],
  "grok-build": [
    {
      value: "grok-4.6",
      name: "Grok 4.6",
      description: "Latest Grok Build model, vision, 500K context",
    },
    {
      value: "grok-4.5",
      name: "Grok 4.5",
      description: "Previous Grok Build model, vision, 500K context",
    },
  ],
  google: [
    {
      value: "gemini-3.6-flash",
      name: "Gemini 3.6 Flash",
      description: "Agentic and multimodal, reasoning, 1M context",
    },
    {
      value: "gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      description: "Coding and sustained agentic work, reasoning, 1M context",
    },
    {
      value: "gemini-3.5-flash-lite",
      name: "Gemini 3.5 Flash-Lite",
      description: "Fast high-volume automation, reasoning, 1M context",
    },
    {
      value: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      description: "Preview reasoning and multimodal model, 1M context",
    },
    {
      value: "gemini-3.1-flash-lite",
      name: "Gemini 3.1 Flash Lite",
      description: "Stable low-cost model, reasoning, 1M context",
    },
  ],
  xai: [
    {
      value: "grok-4.5",
      name: "Grok 4.5",
      description: "Coding and agentic work, reasoning, vision, 500K context",
    },
    {
      value: "grok-4.3",
      name: "Grok 4.3",
      description: "Reasoning, vision, 1M context",
    },
  ],
  groq: [
    {
      value: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      description: "Large reasoning model, 131K context",
    },
    {
      value: "openai/gpt-oss-20b",
      name: "GPT OSS 20B",
      description: "Fast reasoning model, 131K context",
    },
  ],
  openrouter: [
    {
      value: "anthropic/claude-fable-5.1",
      name: "Claude Fable 5.1",
      description: "Advanced Claude reasoning and agentic coding via OpenRouter",
    },
    {
      value: "openai/gpt-6-astra",
      name: "GPT-6 Astra",
      description: "Advanced reasoning and coding via OpenRouter",
    },
    {
      value: "google/gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      description: "Agentic coding and multimodal reasoning via OpenRouter",
    },
    {
      value: "anthropic/claude-fable-5",
      name: "Claude Fable 5",
      description: "Highest-capability Claude model via OpenRouter",
    },
    {
      value: "anthropic/claude-opus-5",
      name: "Claude Opus 5",
      description: "Complex agentic coding and enterprise work",
    },
    {
      value: "anthropic/claude-sonnet-5",
      name: "Claude Sonnet 5",
      description: "Balanced Claude model for production workloads",
    },
    {
      value: "openai/gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "Frontier reasoning and coding via OpenRouter",
    },
    {
      value: "openai/gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      description: "Balanced GPT-5.6 model via OpenRouter",
    },
    {
      value: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      description: "Fast GPT-5.6 model via OpenRouter",
    },
    {
      value: "google/gemini-3.6-flash",
      name: "Gemini 3.6 Flash",
      description: "Agentic and multimodal Gemini model",
    },
    {
      value: "google/gemini-3.5-flash-lite",
      name: "Gemini 3.5 Flash-Lite",
      description: "Fast high-volume Gemini model",
    },
    {
      value: "x-ai/grok-4.5",
      name: "Grok 4.5",
      description: "Coding and agentic Grok model",
    },
    {
      value: "x-ai/grok-4.20",
      name: "Grok 4.20",
      description: "Grok 4.20 through OpenRouter",
    },
    {
      value: "z-ai/glm-5.2",
      name: "GLM-5.2",
      description: "Long-horizon agentic reasoning",
    },
    {
      value: "minimax/minimax-m3",
      name: "MiniMax M3",
      description: "Long-context multimodal agent model",
    },
    {
      value: "moonshotai/kimi-k3",
      name: "Kimi K3",
      description: "Flagship long-context Kimi model",
    },
    {
      value: "moonshotai/kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      description: "Coding-focused Kimi model",
    },
    {
      value: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      description: "Fast DeepSeek reasoning model",
    },
    {
      value: "qwen/qwen3.7-max",
      name: "Qwen3.7 Max",
      description: "High-capability Qwen model",
    },
    {
      value: "qwen/qwen3.7-plus",
      name: "Qwen3.7 Plus",
      description: "Balanced Qwen model",
    },
    {
      value: "anthropic/claude-opus-4.8",
      name: "Claude Opus 4.8",
      description: "Reasoning and vision, 1M context",
    },
    {
      value: "anthropic/claude-opus-4.7",
      name: "Claude Opus 4.7",
      description: "Reasoning and vision, 1M context",
    },
    {
      value: "anthropic/claude-sonnet-4.6",
      name: "Claude Sonnet 4.6",
      description: "Balanced reasoning and vision, 1M context",
    },
    {
      value: "openai/gpt-5.5",
      name: "GPT-5.5",
      description: "Frontier reasoning and vision, 1M context",
    },
    {
      value: "google/gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      description: "Preview reasoning and multimodal model, 1M context",
    },
    {
      value: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      description: "Reasoning model, 1M context",
    },
    {
      value: "qwen/qwen3.6-35b-a3b",
      name: "Qwen3.6 35B A3B",
      description: "Reasoning model, 262K context",
    },
    { value: "z-ai/glm-5.1", name: "GLM-5.1", description: "Reasoning, 202K context" },
    {
      value: "x-ai/grok-4.3",
      name: "Grok 4.3",
      description: "Reasoning and vision, 1M context",
    },
    {
      value: "minimax/minimax-m2.7",
      name: "MiniMax M2.7",
      description: "Reasoning, 196K context",
    },
    {
      value: "moonshotai/kimi-k2.6",
      name: "Kimi K2.6",
      description: "Reasoning and vision, 262K context",
    },
    {
      value: "nvidia/nemotron-nano-9b-v2:free",
      name: "Nemotron Nano 9B",
      description: "Small free reasoning model",
    },
  ],
  moonshot: [
    {
      value: "kimi-for-coding",
      name: "Kimi for Coding",
      description: "Coding plan, reasoning, 262K context",
    },
    {
      value: "k3",
      name: "Kimi K3",
      description: "Flagship coding model, reasoning, vision, 1M context",
    },
    {
      value: "k3-256k",
      name: "Kimi K3 256K",
      description: "Quota-efficient K3 variant, reasoning, vision, 256K context",
    },
    {
      value: "kimi-for-coding-highspeed",
      name: "Kimi for Coding HighSpeed",
      description: "Faster Kimi coding model, reasoning, vision, 256K context",
    },
  ],
  mistral: [
    {
      value: "mistral-medium-latest",
      name: "Mistral Medium (Latest)",
      description: "Agentic coding and multimodal reasoning, 262K context",
    },
    {
      value: "mistral-small-2603",
      name: "Mistral Small 4",
      description: "Efficient reasoning, coding and vision, 256K context",
    },
    {
      value: "mistral-large-2512",
      name: "Mistral Large 3",
      description: "General-purpose multimodal model, 262K context",
    },
    {
      value: "mistral-small-latest",
      name: "Mistral Small",
      description: "Reasoning and vision, 256K context",
    },
    {
      value: "mistral-large-latest",
      name: "Mistral Large",
      description: "General-purpose multimodal model, 262K context",
    },
  ],
  cerebras: [
    { value: "gpt-oss-120b", name: "GPT OSS 120B", description: "Reasoning, 131K context" },
    { value: "zai-glm-4.7", name: "ZAI GLM-4.7", description: "Reasoning, 131K context" },
    {
      value: "gemma-4-31b",
      name: "Gemma 4 31B",
      description: "Fast multimodal reasoning, 131K context",
    },
  ],
  zai: [
    { value: "glm-5.2", name: "GLM-5.2", description: "Long-horizon reasoning, 1M context" },
    { value: "glm-5.1", name: "GLM-5.1", description: "Reasoning, 200K context" },
    { value: "glm-5-turbo", name: "GLM-5 Turbo", description: "Fast reasoning, 200K context" },
  ],
  minimax: [
    {
      value: "MiniMax-M3",
      name: "MiniMax M3",
      description: "Agentic coding, reasoning, vision, 1M context",
    },
    { value: "MiniMax-M2.7", name: "MiniMax M2.7", description: "Reasoning, 204K context" },
    {
      value: "MiniMax-M2.7-highspeed",
      name: "MiniMax M2.7 Fast",
      description: "Fast reasoning, 204K context",
    },
  ],
  huggingface: [
    {
      value: "deepseek-ai/DeepSeek-V4-Flash",
      name: "DeepSeek V4 Flash",
      description: "Fast reasoning, 1M context",
    },
    {
      value: "MiniMaxAI/MiniMax-M3",
      name: "MiniMax M3",
      description: "Agentic multimodal model, 512K effective context",
    },
    {
      value: "Qwen/Qwen3.6-35B-A3B",
      name: "Qwen3.6 35B A3B",
      description: "Efficient reasoning model, 262K context",
    },
    {
      value: "Qwen/Qwen3.6-27B",
      name: "Qwen3.6 27B",
      description: "Dense reasoning model, 262K context",
    },
    {
      value: "Qwen/Qwen3-Next-80B-A3B-Instruct",
      name: "Qwen3 Next 80B A3B",
      description: "Efficient instruction model, 262K context",
    },
    {
      value: "moonshotai/Kimi-K2.7-Code",
      name: "Kimi K2.7 Code",
      description: "Coding and reasoning, 262K context",
    },
    {
      value: "zai-org/GLM-5.2",
      name: "GLM-5.2",
      description: "Long-horizon reasoning, 262K effective context",
    },
    {
      value: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      description: "Open reasoning model, 131K context",
    },
    {
      value: "stepfun-ai/Step-3.7-Flash",
      name: "Step 3.7 Flash",
      description: "Fast reasoning model, 262K context",
    },
    {
      value: "deepseek-ai/DeepSeek-V4-Pro",
      name: "DeepSeek V4 Pro",
      description: "Reasoning, 1M context",
    },
    {
      value: "Qwen/Qwen3.5-397B-A17B",
      name: "Qwen3.5 397B",
      description: "Reasoning, 262K context",
    },
    {
      value: "Qwen/Qwen3-Coder-Next",
      name: "Qwen3 Coder Next",
      description: "Coding, 262K context",
    },
    {
      value: "moonshotai/Kimi-K2.6",
      name: "Kimi K2.6",
      description: "Reasoning and vision, 262K context",
    },
    { value: "zai-org/GLM-5.1", name: "GLM-5.1", description: "Reasoning, 202K context" },
    {
      value: "MiniMaxAI/MiniMax-M2.7",
      name: "MiniMax M2.7",
      description: "Reasoning, 204K context",
    },
  ],
  gocoon: [
    {
      value: "Qwen/Qwen3-32B",
      name: "Qwen3-32B",
      description: "Decentralized inference on TON",
    },
  ],
};

function catalogKey(provider: string): string {
  return provider === "codex" ? "openai-codex" : provider;
}

export function getModelAvailability(
  provider: string,
  modelId: string
): { available: boolean; message?: string } {
  const model = MODEL_OPTIONS[catalogKey(provider)]?.find((option) => option.value === modelId);
  if (!model?.gate || model.gate.enabled()) return { available: true };
  return { available: false, message: model.gate.disabledMessage };
}

export function assertModelAvailable(provider: string, modelId: string): void {
  const availability = getModelAvailability(provider, modelId);
  if (!availability.available) throw new Error(availability.message);
}

/** Get models for a provider (codex → openai-codex) */
export function getModelsForProvider(provider: string): ModelOption[] {
  return (MODEL_OPTIONS[catalogKey(provider)] || [])
    .filter((model) => !model.gate || model.gate.enabled())
    .map(({ gate: _gate, ...model }) => model);
}
