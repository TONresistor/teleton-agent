import type { EmbeddingProvider, EmbeddingProviderConfig } from "./provider.js";
import { NoopEmbeddingProvider } from "./provider.js";
import { AnthropicEmbeddingProvider } from "./anthropic.js";
import { LocalEmbeddingProvider } from "./local.js";

export * from "./provider.js";
export * from "./anthropic.js";
export * from "./local.js";

/**
 * Create an embedding provider based on configuration
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "anthropic":
      if (!config.apiKey) {
        throw new Error("API key required for Anthropic embedding provider");
      }
      return new AnthropicEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
      });

    case "local":
      return new LocalEmbeddingProvider({
        model: config.model,
      });

    case "none":
      return new NoopEmbeddingProvider();

    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

/**
 * Compute hash for text (for caching)
 */
export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Serialize embedding to string for storage
 */
export function serializeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

/**
 * Deserialize embedding from string
 */
export function deserializeEmbedding(data: string): number[] {
  try {
    return JSON.parse(data) as number[];
  } catch {
    return [];
  }
}

/**
 * Convert embedding to binary blob for sqlite-vec
 */
export function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}
