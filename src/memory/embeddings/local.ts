import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { EmbeddingProvider } from "./provider.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Memory");

// Force model cache into ~/.teleton/models/ (writable even with npm install -g)
const modelCacheDir = join(TELETON_ROOT, "models");
try {
  mkdirSync(modelCacheDir, { recursive: true });
} catch {
  // Will fail later with a clear error during warmup
}
env.cacheDir = modelCacheDir;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(model: string): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    log.info(`Loading local embedding model: ${model} (cache: ${modelCacheDir})`);
    extractorPromise = pipeline("feature-extraction", model, {
      dtype: "fp32",
      // Explicit cache_dir to avoid any env race condition
      cache_dir: modelCacheDir,
    })
      .then((ext) => {
        log.info(`Local embedding model ready`);
        return ext;
      })
      .catch((err) => {
        log.error(`Failed to load embedding model: ${(err as Error).message}`);
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
   * If loading fails, retries once then marks provider as disabled (FTS5-only).
   * Call this once during app init — avoids retry spam on every message.
   * @returns true if model loaded successfully, false if fallback to noop
   */
  async warmup(): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await getExtractor(this.model);
        return true;
      } catch (err) {
        if (attempt === 1) {
          log.warn(`Embedding model load failed (attempt 1), retrying...`);
          // Small delay before retry
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          log.warn(
            `Local embedding model unavailable — falling back to FTS5-only search (no vector embeddings)`
          );
          this._disabled = true;
          return false;
        }
      }
    }
    return false;
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
