import { createHash } from "node:crypto";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "./provider.js";
import { NoopEmbeddingProvider } from "./provider.js";
import { AnthropicEmbeddingProvider } from "./anthropic.js";
import { LocalEmbeddingProvider } from "./local.js";

export * from "./provider.js";
export * from "./anthropic.js";
export * from "./local.js";
export * from "./cached.js";

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
 * Compute SHA-256 hash for text (for caching and content dedup)
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Serialize embedding to binary blob for storage
 */
export function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Deserialize embedding from storage (handles both BLOB and legacy JSON TEXT)
 */
export function deserializeEmbedding(data: Buffer | string): number[] {
  try {
    if (Buffer.isBuffer(data)) {
      const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
      return Array.from(floats);
    }
    // Legacy: JSON string format
    return JSON.parse(data) as number[];
  } catch {
    return [];
  }
}
