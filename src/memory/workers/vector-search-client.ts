import { Worker } from "node:worker_threads";
import { resolveMemoryWorkerLaunch } from "./paths.js";
import type {
  VectorContextSearchPayload,
  VectorKnowledgeSearchPayload,
  VectorSearchResult,
  VectorToolSearchPayload,
  VectorToolSearchResult,
  VectorSearchWorkerData,
} from "./protocol.js";
import { WorkerRpcClient } from "./rpc-client.js";

export class VectorSearchWorkerClient {
  private readonly rpc: WorkerRpcClient;

  constructor(databasePath: string) {
    this.rpc = new WorkerRpcClient(
      "vector search",
      () => {
        const launch = resolveMemoryWorkerLaunch("vector-search-worker");
        return new Worker(launch.url, {
          workerData: { databasePath } satisfies VectorSearchWorkerData,
          argv: launch.argv,
          execArgv: launch.execArgv,
        });
      },
      30_000
    );
  }

  search(payload: VectorContextSearchPayload): Promise<VectorSearchResult> {
    return this.rpc.request<VectorSearchResult>(payload);
  }

  searchKnowledge(payload: VectorKnowledgeSearchPayload): Promise<VectorSearchResult["knowledge"]> {
    return this.rpc.request<VectorSearchResult["knowledge"]>(payload);
  }

  searchTools(payload: VectorToolSearchPayload): Promise<VectorToolSearchResult[]> {
    return this.rpc.request<VectorToolSearchResult[]>(payload);
  }

  close(): Promise<void> {
    return this.rpc.close();
  }
}
