import type { EmbeddingProvider, EmbeddingProviderConfig } from "./provider.js";
import { NoopEmbeddingProvider } from "./provider.js";
import { AnthropicEmbeddingProvider } from "./anthropic.js";
import { LocalEmbeddingProvider } from "./local.js";

export * from "./provider.js";
export * from "./anthropic.js";
export * from "./local.js";
export * from "./cached.js";
export * from "./utils.js";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "anthropic":
    case "voyage":
      if (!config.apiKey) {
        throw new Error("Set embedding.api_key or TELETON_EMBEDDING_API_KEY for Voyage embeddings");
      }
      return new AnthropicEmbeddingProvider({
        apiKey: config.apiKey,
        model: config.model,
        dimensions: config.dimensions,
      });

    case "local":
      return new LocalEmbeddingProvider({
        model: config.model,
        dimensions: config.dimensions,
      });

    case "none":
      return new NoopEmbeddingProvider();

    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
