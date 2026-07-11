/**
 * Shared model catalog used by WebUI setup, CLI onboard, and config routes.
 * To add a model, add it here — it will appear in all UIs automatically.
 * Models must exist in pi-ai's registry (or be entered as custom).
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

const CODEX_LUNA_MODEL_ID = "gpt-5.6-luna";

function isCodexLunaEnabled(): boolean {
  return process.env.TELETON_ENABLE_CODEX_LUNA?.trim().toLowerCase() === "true";
}

const MODEL_OPTIONS: Record<string, CatalogModelOption[]> = {
  anthropic: [
    {
      value: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      description: "Most capable available, 1M ctx, reasoning, $5/$25",
    },
    {
      value: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      description: "Previous gen, 1M ctx, reasoning, $5/$25",
    },
    {
      value: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      description: "Previous gen, 1M ctx, reasoning, $5/$25",
    },
    {
      value: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      description: "Older gen, 200K ctx, $5/$25",
    },
    {
      value: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "Balanced, 1M ctx, reasoning, $3/$15",
    },
    {
      value: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fast & cheap, 200K ctx, $1/$5 (default)",
    },
  ],
  openai: [
    {
      value: "gpt-5.5",
      name: "GPT-5.5",
      description: "Latest frontier, reasoning, 272K ctx, $5/$30",
    },
    {
      value: "gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      description: "Max capability, reasoning, 1M ctx, $30/$180",
    },
    { value: "gpt-5.4", name: "GPT-5.4", description: "Reasoning, 272K ctx, $2.50/$15" },
    {
      value: "gpt-5.4-pro",
      name: "GPT-5.4 Pro",
      description: "Extended thinking, 1M ctx, $30/$180",
    },
    {
      value: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      description: "Fast & cheap, reasoning, 400K ctx, $0.75/$4.50",
    },
    { value: "gpt-4o", name: "GPT-4o", description: "Balanced, 128K ctx, $2.50/$10" },
    { value: "gpt-4.1", name: "GPT-4.1", description: "1M ctx, $2/$8" },
    { value: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "1M ctx, cheap, $0.40/$1.60" },
  ],
  "openai-codex": [
    { value: "gpt-5.5", name: "GPT-5.5", description: "Latest stable, reasoning, 272K ctx" },
    {
      value: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      description: "Latest frontier agentic coding model, preview, 372K ctx",
    },
    {
      value: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      description: "Balanced agentic coding model, preview, 372K ctx",
    },
    {
      value: CODEX_LUNA_MODEL_ID,
      name: "GPT-5.6 Luna",
      description: "Fast and affordable agentic coding model, preview, 372K ctx",
      gate: {
        enabled: isCodexLunaEnabled,
        disabledMessage:
          "gpt-5.6-luna is disabled because the Codex backend does not currently advertise it; use gpt-5.6-terra or set TELETON_ENABLE_CODEX_LUNA=true only for controlled revalidation",
      },
    },
    { value: "gpt-5.4", name: "GPT-5.4", description: "Reasoning, 272K ctx" },
    { value: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Fast & cheap, reasoning" },
    { value: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Coding specialist, 272K ctx" },
    {
      value: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      description: "Coding, preview, free",
    },
  ],
  "grok-build": [
    {
      value: "grok-build",
      name: "Grok Build",
      description: "Coding model via your Grok CLI subscription, 500K ctx",
    },
  ],
  google: [
    {
      value: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      description: "Preview, latest gen, reasoning, 1M ctx, $2/$12",
    },
    {
      value: "gemini-3.1-flash-lite-preview",
      name: "Gemini 3.1 Flash Lite",
      description: "Preview, fast & cheap, reasoning, 1M ctx, $0.25/$1.50",
    },
    { value: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Stable, 1M ctx, $1.25/$10" },
    {
      value: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description: "Fast, 1M ctx, $0.30/$2.50",
    },
    {
      value: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash Lite",
      description: "Ultra cheap, 1M ctx, $0.10/$0.40",
    },
  ],
  xai: [
    {
      value: "grok-4.3",
      name: "Grok 4.3",
      description: "Latest, reasoning, vision, 1M ctx, $1.25/$2.50",
    },
    {
      value: "grok-4.20-0309-reasoning",
      name: "Grok 4.20 Reasoning",
      description: "Reasoning, vision, 2M ctx, $2/$6",
    },
    {
      value: "grok-4.20-0309-non-reasoning",
      name: "Grok 4.20 Non-Reasoning",
      description: "Fast, vision, 2M ctx, $2/$6",
    },
    {
      value: "grok-4-1-fast-non-reasoning",
      name: "Grok 4.1 Fast",
      description: "Fast, vision, 2M ctx, $0.20/$0.50",
    },
  ],
  groq: [
    {
      value: "meta-llama/llama-4-maverick-17b-128e-instruct",
      name: "Llama 4 Maverick",
      description: "Vision, 131K ctx, $0.20/M",
    },
    {
      value: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      description: "Reasoning, 131K ctx, $0.15/M",
    },
    { value: "qwen/qwen3-32b", name: "Qwen3 32B", description: "Reasoning, 131K ctx, $0.29/M" },
  ],
  openrouter: [
    {
      value: "anthropic/claude-opus-4.8",
      name: "Claude Opus 4.8",
      description: "Latest, 1M ctx, reasoning, $5/M",
    },
    {
      value: "anthropic/claude-opus-4.7",
      name: "Claude Opus 4.7",
      description: "Previous gen, 1M ctx, reasoning, $5/M",
    },
    {
      value: "anthropic/claude-sonnet-4.6",
      name: "Claude Sonnet 4.6",
      description: "Balanced, 1M ctx, $3/M",
    },
    { value: "openai/gpt-5.5", name: "GPT-5.5", description: "Frontier, reasoning, 1M ctx, $5/M" },
    {
      value: "google/gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      description: "Preview, reasoning, 1M ctx, $2/M",
    },
    {
      value: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      description: "Latest, reasoning, 1M ctx, $0.44/M",
    },
    {
      value: "qwen/qwen3.6-35b-a3b",
      name: "Qwen3.6 35B A3B",
      description: "Reasoning, 262K ctx, $0.15/M",
    },
    { value: "z-ai/glm-5.1", name: "GLM-5.1", description: "Reasoning, 202K ctx, $1.05/M" },
    {
      value: "x-ai/grok-4.3",
      name: "Grok 4.3",
      description: "Reasoning, vision, 1M ctx, $1.25/M",
    },
    {
      value: "minimax/minimax-m2.7",
      name: "MiniMax M2.7",
      description: "Reasoning, 196K ctx, $0.30/M",
    },
    {
      value: "moonshotai/kimi-k2.6",
      name: "Kimi K2.6",
      description: "Reasoning, vision, 262K ctx, $0.75/M",
    },
    {
      value: "nvidia/nemotron-nano-9b-v2",
      name: "Nemotron Nano 9B",
      description: "Small & fast, 131K ctx, $0.04/M",
    },
  ],
  moonshot: [
    {
      value: "kimi-for-coding",
      name: "Kimi for Coding",
      description: "Coding plan, reasoning, 262K ctx",
    },
    {
      value: "kimi-k2-thinking",
      name: "Kimi K2 Thinking",
      description: "Reasoning, 262K ctx",
    },
  ],
  mistral: [
    { value: "devstral-2512", name: "Devstral 2", description: "Coding, 262K ctx, $0.40/M" },
    {
      value: "mistral-small-latest",
      name: "Mistral Small",
      description: "Reasoning, 256K ctx, $0.15/M",
    },
    {
      value: "mistral-medium-latest",
      name: "Mistral Medium",
      description: "Reasoning, 262K ctx, $1.50/M",
    },
    {
      value: "mistral-large-latest",
      name: "Mistral Large",
      description: "General, 262K ctx, $0.50/M",
    },
  ],
  cerebras: [
    {
      value: "qwen-3-235b-a22b-instruct-2507",
      name: "Qwen 3 235B",
      description: "131K ctx, $0.60/$1.20",
    },
    { value: "gpt-oss-120b", name: "GPT OSS 120B", description: "Reasoning, 131K ctx, $0.25/M" },
    { value: "zai-glm-4.7", name: "ZAI GLM-4.7", description: "131K ctx, $2.25/M" },
    { value: "llama3.1-8b", name: "Llama 3.1 8B", description: "Fast & cheap, 32K ctx, $0.10/M" },
  ],
  zai: [
    { value: "glm-5.1", name: "GLM-5.1", description: "Latest, reasoning, 200K ctx" },
    { value: "glm-5-turbo", name: "GLM-5 Turbo", description: "Fast reasoning, 200K ctx" },
  ],
  minimax: [
    { value: "MiniMax-M2.7", name: "MiniMax M2.7", description: "204K ctx, $0.30/$1.20" },
    {
      value: "MiniMax-M2.7-highspeed",
      name: "MiniMax M2.7 Fast",
      description: "204K ctx, $0.60/$2.40",
    },
  ],
  huggingface: [
    {
      value: "deepseek-ai/DeepSeek-V4-Pro",
      name: "DeepSeek V4 Pro",
      description: "Latest, reasoning, 1M ctx, $1.74/M",
    },
    {
      value: "Qwen/Qwen3.5-397B-A17B",
      name: "Qwen3.5 397B",
      description: "Reasoning, 262K ctx, $0.60/M",
    },
    {
      value: "Qwen/Qwen3-Coder-Next",
      name: "Qwen3 Coder Next",
      description: "Coding, 262K ctx, $0.20/M",
    },
    {
      value: "moonshotai/Kimi-K2.6",
      name: "Kimi K2.6",
      description: "Reasoning, vision, 262K ctx, $0.95/M",
    },
    { value: "zai-org/GLM-5.1", name: "GLM-5.1", description: "Reasoning, 202K ctx, $1/M" },
    {
      value: "MiniMaxAI/MiniMax-M2.7",
      name: "MiniMax M2.7",
      description: "Reasoning, 204K ctx, $0.30/M",
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
