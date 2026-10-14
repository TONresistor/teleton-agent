import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ width: 384, truncateBatch: false, calls: 0 }));
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: vi.fn(async () => async (input: string | string[]) => {
    state.calls++;
    const count = Array.isArray(input) ? input.length : 1;
    const size = count * state.width - (state.truncateBatch && Array.isArray(input) ? 1 : 0);
    const data = new Float32Array(size);
    for (let index = 0; index < size; index++) data[index] = Math.floor(index / state.width) + 1;
    return { dims: [count, state.width], data };
  }),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 2_000_000 })),
}));

beforeEach(() => {
  vi.resetModules();
  state.width = 384;
  state.truncateBatch = false;
  state.calls = 0;
});
afterEach(() => vi.useRealTimers());

describe("local model output shape", () => {
  it("rejects a 384-dimensional query when configured for 256 dimensions", async () => {
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 256 });
    await expect(provider.embedQuery("query")).rejects.toThrow(
      "Local model produces 384 dimensions; configured 256"
    );
  });

  it("rejects a wider batch instead of slicing across document boundaries", async () => {
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 256 });
    await expect(provider.embedBatch(["first", "second"])).rejects.toThrow(
      "Local model produces 384 dimensions; configured 256"
    );
  });

  it("returns independent vectors from a batch with the expected dimensions", async () => {
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 384 });
    expect(await provider.embedBatch(["first", "second"])).toEqual([
      Array(384).fill(1),
      Array(384).fill(2),
    ]);
    expect(await provider.embedQuery("query")).toEqual(Array(384).fill(1));
  });

  it("rejects a truncated tensor even when its declared width is correct", async () => {
    state.truncateBatch = true;
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 384 });
    await expect(provider.embedBatch(["first", "second"])).rejects.toThrow(
      "Embedding batch shape does not match the input count"
    );
  });

  it("disables a mismatched model during warmup before any vector can be persisted", async () => {
    vi.useFakeTimers();
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 256 });
    const warmup = provider.warmup();
    await vi.runAllTimersAsync();
    expect(await warmup).toBe(false);
    expect(state.calls).toBe(2);
    expect(await provider.embedQuery("query")).toEqual([]);
    expect(await provider.embedBatch(["first", "second"])).toEqual([]);
    expect(state.calls).toBe(2);
  });

  it("recovers inference on the same provider after a failed warmup", async () => {
    vi.useFakeTimers();
    state.width = 256;
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 384 });
    const failedWarmup = provider.warmup();
    await vi.runAllTimersAsync();
    expect(await failedWarmup).toBe(false);
    expect(await provider.embedQuery("query")).toEqual([]);

    state.width = 384;
    expect(await provider.warmup()).toBe(true);
    expect(await provider.embedQuery("query")).toEqual(Array(384).fill(1));
    expect(await provider.embedBatch(["first", "second"])).toEqual([
      Array(384).fill(1),
      Array(384).fill(2),
    ]);
  });

  it("accepts warmup when the model width matches configuration", async () => {
    const { LocalEmbeddingProvider } = await import("../embeddings/local.js");
    const provider = new LocalEmbeddingProvider({ dimensions: 384 });
    expect(await provider.warmup()).toBe(true);
  });
});
