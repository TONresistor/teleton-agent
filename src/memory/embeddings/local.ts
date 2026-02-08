import type { EmbeddingProvider } from "./provider.js";

/**
 * Local embedding provider placeholder
 * TODO: Integrate @xenova/transformers or similar for local embeddings
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local";
  readonly model: string;
  readonly dimensions: number;
  private hasWarned = false;

  constructor(config: { model?: string }) {
    this.model = config.model ?? "all-MiniLM-L6-v2";
    this.dimensions = 384; // all-MiniLM-L6-v2 dimensions
  }

  async embedQuery(text: string): Promise<number[]> {
    // TODO: Implement local embedding
    // For now, return zero vector
    if (!this.hasWarned) {
      console.warn(
        "⚠️  Local embeddings not yet implemented. Returning zero vectors. " +
          "This will not work for semantic search. Consider using 'anthropic' embedding provider."
      );
      this.hasWarned = true;
    }
    return new Array(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // TODO: Implement batch local embedding
    if (!this.hasWarned) {
      console.warn(
        "⚠️  Local embeddings not yet implemented. Returning zero vectors. " +
          "This will not work for semantic search. Consider using 'anthropic' embedding provider."
      );
      this.hasWarned = true;
    }
    return texts.map(() => new Array(this.dimensions).fill(0));
  }
}
