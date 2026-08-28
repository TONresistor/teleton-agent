import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcState = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("../workers/rpc-client.js", () => ({
  WorkerRpcClient: class {
    request = vi.fn(async (payload: { type: string }) => {
      if (payload.type === "warmup") return true;
      if (payload.type === "embedQuery") return [1];
      return [[1]];
    });
    close = vi.fn(async () => undefined);

    constructor(..._args: unknown[]) {
      rpcState.instances.push(this);
    }
  },
}));

import { EmbeddingWorkerProvider } from "../workers/embedding-provider.js";

describe("EmbeddingWorkerProvider", () => {
  beforeEach(() => {
    rpcState.instances.length = 0;
  });

  it("serializes query and batch inference through one native worker", async () => {
    const provider = new EmbeddingWorkerProvider({ provider: "none" });

    await provider.warmup();
    await Promise.all([provider.embedQuery("query"), provider.embedBatch(["document"])]);
    await provider.close();

    expect(rpcState.instances).toHaveLength(1);
  });
});
