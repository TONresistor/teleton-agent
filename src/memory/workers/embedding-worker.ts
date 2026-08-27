import { parentPort, workerData } from "node:worker_threads";
import { createEmbeddingProvider } from "../embeddings/index.js";
import type {
  EmbeddingWorkerData,
  EmbeddingWorkerPayload,
  RpcRequest,
  RpcResponse,
} from "./protocol.js";

if (!parentPort) throw new Error("Embedding worker requires a parent port");
const port = parentPort;

const provider = createEmbeddingProvider((workerData as EmbeddingWorkerData).config);
let queue = Promise.resolve();

async function handle(payload: EmbeddingWorkerPayload): Promise<unknown> {
  switch (payload.type) {
    case "warmup":
      return provider.warmup?.() ?? true;
    case "embedQuery":
      return provider.embedQuery(payload.text);
    case "embedBatch":
      return provider.embedBatch(payload.texts);
  }
}

port.on("message", (request: RpcRequest) => {
  queue = queue.then(async () => {
    const payload = request.payload as EmbeddingWorkerPayload;
    try {
      const result = await handle(payload);
      port.postMessage({ id: request.id, ok: true, result } satisfies RpcResponse);
    } catch (error) {
      port.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RpcResponse);
    }
  });
});
