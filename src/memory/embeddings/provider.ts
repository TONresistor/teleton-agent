export interface EmbeddingProvider {
  id: string;
  model: string;
  dimensions: number;

  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Optional startup warmup — pre-load model, validate credentials, etc. */
  warmup?(): Promise<boolean>;
}

export interface EmbeddingProviderConfig {
  provider: "anthropic" | "local" | "none";
  model?: string;
  apiKey?: string;
  dimensions?: number;
}

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
