import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { join, dirname } from "node:path";
import { mkdirSync, writeFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import type { EmbeddingProvider } from "./provider.js";
import { TELETON_ROOT } from "../../workspace/paths.js";
import { readResponseBuffer } from "../../utils/response-body.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { randomUUID } from "node:crypto";
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

/** Minimum valid file sizes — detects truncated/corrupt cache from FileCache.put() bug */
const MIN_FILE_SIZES: Record<string, number> = { "onnx/model.onnx": 1_000_000 };

function isCacheFileValid(filePath: string, fileName: string): boolean {
  try {
    return statSync(filePath).size >= (MIN_FILE_SIZES[fileName] ?? 1);
  } catch {
    return false;
  }
}

/**
 * Pre-download model files to cache directory using native fetch.
 * Workaround for @huggingface/transformers v3.x FileCache.put() bug:
 * the library downloads the model (Response 200) but silently fails to
 * write it to disk, causing "Unable to get model file path or buffer".
 * By pre-populating the cache, pipeline() finds the files via FileCache.match()
 * and never hits the broken put() path.
 *
 * Safety: validates existing files by size (catches corrupt/truncated cache),
 * uses atomic write-then-rename (prevents partial files on crash).
 */
async function ensureModelCached(model: string): Promise<void> {
  const files = ["config.json", "tokenizer_config.json", "tokenizer.json", "onnx/model.onnx"];
  const baseUrl = `https://huggingface.co/${model}/resolve/main`;

  for (const file of files) {
    const localPath = join(modelCacheDir, model, file);

    if (isCacheFileValid(localPath, file)) continue;

    // Remove corrupt/partial file before re-downloading
    try {
      unlinkSync(localPath);
    } catch {
      /* not found is fine */
    }

    log.info(`Downloading ${model}/${file}...`);
    mkdirSync(dirname(localPath), { recursive: true });

    const res = await fetchWithTimeout(`${baseUrl}/${file}`, {
      redirect: "follow",
      timeoutMs: 120_000,
    });
    if (!res.ok) {
      throw new Error(`Failed to download ${model}/${file}: ${res.status} ${res.statusText}`);
    }
    const buffer = await readResponseBuffer(res, 512 * 1024 * 1024);

    // Atomic write: tmp → rename (crash-safe, no partial files)
    const tmpPath = localPath + `.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmpPath, buffer, { mode: 0o600 });
      renameSync(tmpPath, localPath);
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* already renamed */
      }
    }
  }
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(model: string): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    log.info(`Loading local embedding model: ${model} (cache: ${modelCacheDir})`);
    extractorPromise = pipeline("feature-extraction", model, {
      dtype: "fp32",
      // Explicit cache_dir to avoid any env race condition
      cache_dir: modelCacheDir,
      // Prevent pthread_setaffinity_np EINVAL on VPS/containers with restricted CPU sets.
      // ONNX Runtime skips thread affinity when thread counts are explicit.
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
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

  constructor(config: { model?: string; dimensions?: number }) {
    this.model = config.model || "Xenova/all-MiniLM-L6-v2";
    this.dimensions = config.dimensions ?? 384;
  }

  /**
   * Pre-download and load the model at startup.
   * If loading fails, retries once then marks provider as disabled (FTS5-only).
   * Call this once during app init — avoids retry spam on every message.
   */
  async warmup(): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await ensureModelCached(this.model);
        const extractor = await getExtractor(this.model);
        const sample = await extractor("warmup", { pooling: "mean", normalize: true });
        this.validateDimensions(sample.dims);
        return true;
      } catch (error) {
        log.warn({ err: error }, "Embedding warmup failed");
        if (attempt === 1) {
          log.warn(`Embedding model load failed (attempt 1), retrying...`);
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

  private validateDimensions(shape: number[]): void {
    const width = shape[shape.length - 1];
    if (width !== this.dimensions) {
      throw new Error(`Local model produces ${width} dimensions; configured ${this.dimensions}`);
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    if (this._disabled) return [];
    const extractor = await getExtractor(this.model);
    const output = await extractor(text, { pooling: "mean", normalize: true });
    this.validateDimensions(output.dims);
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this._disabled) return [];
    if (texts.length === 0) return [];

    const extractor = await getExtractor(this.model);
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    this.validateDimensions(output.dims);
    const data = output.data as Float32Array;
    if (data.length !== texts.length * this.dimensions)
      throw new Error("Embedding batch shape does not match the input count");
    const dims = this.dimensions;

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(Array.from(data.slice(i * dims, (i + 1) * dims)));
    }
    return results;
  }
}
