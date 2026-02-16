import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "node:path";
import type { EmbeddingProvider } from "./provider.js";
import { TELETON_ROOT } from "../../workspace/paths.js";

// Force model cache into ~/.teleton/models/ (writable even with npm install -g)
env.cacheDir = join(TELETON_ROOT, "models");

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(model: string): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    console.log(`📦 Loading local embedding model: ${model} (cache: ${env.cacheDir})`);
    extractorPromise = pipeline("feature-extraction", model, {
      dtype: "fp32",
    })
      .then((ext) => {
        console.log(`✅ Local embedding model ready`);
        return ext;
      })
      .catch((err) => {
        console.error(`❌ Failed to load embedding model: ${(err as Error).message}`);
        extractorPromise = null;
        throw err;
      });
  }
  return extractorPromise;
}

/**
 * Local embedding provider using @huggingface/transformers (ONNX Runtime).
 * Runs offline after initial model download (~22 MB cached at ~/.teleton/models/).
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local";
  readonly model: string;
  readonly dimensions: number;
  private _disabled = false;

  constructor(config: { model?: string }) {
    this.model = config.model || "Xenova/all-MiniLM-L6-v2";
    this.dimensions = 384;
  }

  /**
   * Pre-download and load the model at startup.
   * If loading fails, marks this provider as disabled (returns empty embeddings).
   * Call this once during app init — avoids retry spam on every message.
   * @returns true if model loaded successfully, false if fallback to noop
   */
  async warmup(): Promise<boolean> {
    try {
      await getExtractor(this.model);
      return true;
    } catch (err) {
      console.warn(
        `⚠️ Local embedding model unavailable — falling back to FTS5-only search (no vector embeddings)`
      );
      this._disabled = true;
      return false;
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    if (this._disabled) return [];
    const extractor = await getExtractor(this.model);
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this._disabled) return [];
    if (texts.length === 0) return [];

    const extractor = await getExtractor(this.model);
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const data = output.data as Float32Array;
    const dims = this.dimensions;

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(Array.from(data.slice(i * dims, (i + 1) * dims)));
    }
    return results;
  }
}
