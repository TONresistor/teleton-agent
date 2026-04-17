/**
 * Shared model catalog used by WebUI setup, CLI onboard, and config routes.
 * To add a model, add it here — it will appear in all UIs automatically.
 * Models must exist in pi-ai's registry (or be entered as custom).
 */

export interface ModelOption {
  value: string;
  name: string;
  description: string;
  /** Whether this model supports reasoning/thinking (used for UI hints) */
  reasoning?: boolean;
}

export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  anthropic: [
    {
      value: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      description: "Most capable, 1M ctx, reasoning",
    },
    {
      value: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      description: "Previous gen, 1M ctx, $5/M",
    },
    {
      value: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      description: "Older gen, 200K ctx, $5/M",
    },
    {
      value: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "Balanced, 200K ctx, $3/M",
    },
    {
      value: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fast & cheap, $1/M (default)",
    },
  ],
  openai: [
    { value: "gpt-5", name: "GPT-5", description: "Most capable, 400K ctx, $1.25/M" },
    { value: "gpt-5-pro", name: "GPT-5 Pro", description: "Extended thinking, 400K ctx", reasoning: true },
    { value: "gpt-5-mini", name: "GPT-5 Mini", description: "Fast & cheap, 400K ctx" },
    {
      value: "gpt-5.4",
      name: "GPT-5.4",
      description: "Latest frontier, reasoning, openai-responses API",
      reasoning: true,
    },
    {
      value: "gpt-5.4-pro",
      name: "GPT-5.4 Pro",
      description: "Extended thinking, openai-responses API",
      reasoning: true,
    },
    { value: "gpt-5.1", name: "GPT-5.1", description: "Latest gen, 400K ctx" },
    { value: "gpt-4o", name: "GPT-4o", description: "Balanced, 128K ctx, $2.50/M" },
    { value: "gpt-4.1", name: "GPT-4.1", description: "1M ctx, $2/M" },
    { value: "gpt-4.1-mini", name: "GPT-4.1 Mini", description: "1M ctx, cheap, $0.40/M" },
    { value: "o4-mini", name: "o4 Mini", description: "Reasoning, fast, 200K ctx", reasoning: true },
    { value: "o3", name: "o3", description: "Reasoning, 200K ctx, $2/M", reasoning: true },
    { value: "codex-mini-latest", name: "Codex Mini", description: "Coding specialist" },
  ],
  "openai-codex": [
    { value: "gpt-5.4", name: "GPT-5.4", description: "Latest frontier, reasoning" },
    { value: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Fast & cheap" },
    { value: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Coding specialist" },
    { value: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "Coding specialist" },
    { value: "gpt-5.1", name: "GPT-5.1", description: "General purpose" },
    { value: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", description: "Max reasoning" },
  ],
  google: [
    { value: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Preview, latest gen" },
    {
      value: "gemini-3.1-flash-lite-preview",
      name: "Gemini 3.1 Flash Lite",
      description: "Preview, fast & cheap",
    },
    { value: "gemini-3-pro-preview", name: "Gemini 3 Pro", description: "Preview, most capable" },
    { value: "gemini-3-flash-preview", name: "Gemini 3 Flash", description: "Preview, fast" },
    { value: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Stable, 1M ctx, $1.25/M" },
    { value: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Fast, 1M ctx, $0.30/M" },
    {
      value: "gemini-2.5-flash-lite",
      name: "Gemini 2.5 Flash Lite",
      description: "Ultra cheap, 1M ctx",
    },
    { value: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Cheap, 1M ctx, $0.10/M" },
  ],
  xai: [
    { value: "grok-4-1-fast", name: "Grok 4.1 Fast", description: "Latest, vision, 2M ctx" },
    { value: "grok-4-fast", name: "Grok 4 Fast", description: "Vision, 2M ctx, $0.20/M" },
    { value: "grok-4", name: "Grok 4", description: "Reasoning, 256K ctx, $3/M", reasoning: true },
    { value: "grok-code-fast-1", name: "Grok Code", description: "Coding specialist, fast" },
    { value: "grok-3", name: "Grok 3", description: "Stable, 131K ctx, $3/M" },
  ],
  groq: [
    {
      value: "meta-llama/llama-4-maverick-17b-128e-instruct",
      name: "Llama 4 Maverick",
      description: "Vision, 131K ctx, $0.20/M",
    },
    { value: "qwen/qwen3-32b", name: "Qwen3 32B", description: "Reasoning, 131K ctx, $0.29/M", reasoning: true },
    {
      value: "deepseek-r1-distill-llama-70b",
      name: "DeepSeek R1 70B",
      description: "Reasoning, 131K ctx, $0.75/M",
      reasoning: true,
    },
    {
      value: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B",
      description: "General purpose, 131K ctx, $0.59/M",
    },
  ],
  openrouter: [
    {
      value: "anthropic/claude-opus-4.7",
      name: "Claude Opus 4.7",
      description: "Latest, 1M ctx, reasoning",
    },
    { value: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5", description: "200K ctx, $5/M" },
    {
      value: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "200K ctx, $3/M",
    },
    { value: "openai/gpt-5", name: "GPT-5", description: "400K ctx, $1.25/M" },
    { value: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "1M ctx, $0.30/M" },
    {
      value: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      description: "Reasoning, 64K ctx, $0.70/M",
      reasoning: true,
    },
    {
      value: "deepseek/deepseek-r1-0528",
      name: "DeepSeek R1 0528",
      description: "Reasoning improved, 64K ctx",
      reasoning: true,
    },
    {
      value: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      description: "Latest, general, 64K ctx",
    },
    { value: "deepseek/deepseek-v3.1", name: "DeepSeek V3.1", description: "General, 64K ctx" },
    {
      value: "deepseek/deepseek-v3-0324",
      name: "DeepSeek V3",
      description: "General, 64K ctx, $0.30/M",
    },
    { value: "qwen/qwen3-coder", name: "Qwen3 Coder", description: "Coding specialist" },
    { value: "qwen/qwen3-max", name: "Qwen3 Max", description: "Most capable Qwen" },
    { value: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", description: "235B params, MoE" },
    {
      value: "nvidia/nemotron-nano-9b-v2",
      name: "Nemotron Nano 9B",
      description: "Small & fast, Nvidia",
    },
    {
      value: "perplexity/sonar-pro",
      name: "Perplexity Sonar Pro",
      description: "Web search integrated",
    },
    { value: "minimax/minimax-m2.5", name: "MiniMax M2.5", description: "Latest MiniMax" },
    { value: "x-ai/grok-4", name: "Grok 4", description: "256K ctx, $3/M", reasoning: true },
  ],
  moonshot: [
    { value: "k2p5", name: "Kimi K2.5", description: "Free, 262K ctx, multimodal" },
    {
      value: "kimi-k2-thinking",
      name: "Kimi K2 Thinking",
      description: "Free, 262K ctx, reasoning",
      reasoning: true,
    },
  ],
  mistral: [
    {
      value: "devstral-small-2507",
      name: "Devstral Small",
      description: "Coding, 128K ctx, $0.10/M",
    },
    {
      value: "devstral-medium-latest",
      name: "Devstral Medium",
      description: "Coding, 262K ctx, $0.40/M",
    },
    {
      value: "mistral-large-latest",
      name: "Mistral Large",
      description: "General, 128K ctx, $2/M",
    },
    {
      value: "magistral-small",
      name: "Magistral Small",
      description: "Reasoning, 128K ctx, $0.50/M",
      reasoning: true,
    },
  ],
  cerebras: [
    {
      value: "qwen-3-235b-a22b-instruct-2507",
      name: "Qwen 3 235B",
      description: "131K ctx, $0.60/$1.20",
    },
    { value: "gpt-oss-120b", name: "GPT OSS 120B", description: "Reasoning, 131K ctx, $0.25/M", reasoning: true },
    { value: "zai-glm-4.7", name: "ZAI GLM-4.7", description: "131K ctx, $2.25/M" },
    { value: "llama3.1-8b", name: "Llama 3.1 8B", description: "Fast & cheap, 32K ctx, $0.10/M" },
  ],
  zai: [
    { value: "glm-4.7-flash", name: "GLM-4.7 Flash", description: "FREE, 200K ctx" },
    { value: "glm-4.7", name: "GLM-4.7", description: "204K ctx, $0.60/$2.20" },
    { value: "glm-5", name: "GLM-5", description: "Best quality, 204K ctx, $1.00/$3.20" },
    { value: "glm-4.6", name: "GLM-4.6", description: "204K ctx, $0.60/$2.20" },
    { value: "glm-4.5-flash", name: "GLM-4.5 Flash", description: "FREE, 131K ctx" },
    { value: "glm-4.5v", name: "GLM-4.5V", description: "Vision, 64K ctx, $0.60/$1.80" },
  ],
  minimax: [
    { value: "MiniMax-M2.5", name: "MiniMax M2.5", description: "204K ctx, $0.30/$1.20" },
    {
      value: "MiniMax-M2.5-highspeed",
      name: "MiniMax M2.5 Fast",
      description: "204K ctx, $0.60/$2.40",
    },
    { value: "MiniMax-M2.1", name: "MiniMax M2.1", description: "204K ctx, $0.30/$1.20" },
    { value: "MiniMax-M2", name: "MiniMax M2", description: "196K ctx, $0.30/$1.20" },
  ],
  huggingface: [
    {
      value: "deepseek-ai/DeepSeek-V3.2",
      name: "DeepSeek V3.2",
      description: "163K ctx, $0.28/$0.40",
    },
    {
      value: "deepseek-ai/DeepSeek-R1-0528",
      name: "DeepSeek R1",
      description: "Reasoning, 163K ctx, $3/$5",
      reasoning: true,
    },
    {
      value: "Qwen/Qwen3-235B-A22B-Thinking-2507",
      name: "Qwen3 235B",
      description: "Reasoning, 262K ctx, $0.30/$3",
      reasoning: true,
    },
    {
      value: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
      name: "Qwen3 Coder 480B",
      description: "Coding, 262K ctx, $2/$2",
    },
    {
      value: "Qwen/Qwen3-Next-80B-A3B-Instruct",
      name: "Qwen3 Next 80B",
      description: "262K ctx, $0.25/$1",
    },
    {
      value: "moonshotai/Kimi-K2.5",
      name: "Kimi K2.5",
      description: "262K ctx, $0.60/$3",
    },
    {
      value: "zai-org/GLM-4.7-Flash",
      name: "GLM-4.7 Flash",
      description: "FREE, 200K ctx",
    },
    { value: "zai-org/GLM-5", name: "GLM-5", description: "202K ctx, $1/$3.20" },
  ],
};

/** Get models for a provider (claude-code → anthropic, codex → openai-codex) */
export function getModelsForProvider(provider: string): ModelOption[] {
  const key =
    provider === "claude-code" ? "anthropic" : provider === "codex" ? "openai-codex" : provider;
  return MODEL_OPTIONS[key] || [];
}
