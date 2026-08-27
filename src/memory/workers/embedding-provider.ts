import { Worker } from "node:worker_threads";
import { createEmbeddingProvider } from "../embeddings/index.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../embeddings/provider.js";
import { resolveMemoryWorkerLaunch } from "./paths.js";
import type { EmbeddingWorkerData, EmbeddingWorkerPayload } from "./protocol.js";
import { WorkerRpcClient } from "./rpc-client.js";

export class EmbeddingWorkerProvider implements EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly rpc: WorkerRpcClient;

  constructor(config: EmbeddingProviderConfig) {
    const metadata = createEmbeddingProvider(config);
    this.id = metadata.id;
    this.model = metadata.model;
    this.dimensions = metadata.dimensions;
    this.rpc = new WorkerRpcClient(
      "embedding",
      () => {
        const launch = resolveMemoryWorkerLaunch("embedding-worker");
        return new Worker(launch.url, {
          workerData: { config } satisfies EmbeddingWorkerData,
          argv: launch.argv,
          execArgv: launch.execArgv,
        });
      },
      5 * 60_000
    );
  }

  async warmup(): Promise<boolean> {
    const payload: EmbeddingWorkerPayload = { type: "warmup" };
    return this.rpc.request<boolean>(payload);
  }

  async embedQuery(text: string): Promise<number[]> {
    const payload: EmbeddingWorkerPayload = { type: "embedQuery", text };
    return this.rpc.request<number[]>(payload);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const payload: EmbeddingWorkerPayload = {
      type: "embedBatch",
      texts,
    };
    return this.rpc.request<number[][]>(payload);
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }
}
