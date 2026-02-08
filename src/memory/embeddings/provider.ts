/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  id: string;
  model: string;
  dimensions: number;

  /**
   * Embed a single query
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * Embed a batch of texts
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: "anthropic" | "local" | "none";
  model?: string;
  apiKey?: string;
  dimensions?: number;
}

/**
 * No-op embedding provider (disabled embeddings)
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  id = "noop";
  model = "none";
  dimensions = 0;

  async embedQuery(_text: string): Promise<number[]> {
    return [];
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    return [];
  }
}
