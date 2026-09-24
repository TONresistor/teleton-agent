import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock("../../utils/fetch.js", () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

import {
  getProviderModel,
  isCustomOpenRouterModel,
  registerLocalModels,
} from "../model-resolver.js";

describe("dynamic model registry", () => {
  beforeEach(() => mocks.fetchWithTimeout.mockReset());

  it("resolves a manually entered OpenRouter ID without discovery", () => {
    const model = getProviderModel("openrouter", "  example/new-model:free  ");
    expect(model.id).toBe("example/new-model:free");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(isCustomOpenRouterModel(model)).toBe(true);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
    expect(getProviderModel("openrouter", model.id)).toBe(model);
  });

  it("keeps catalog metadata for known OpenRouter models", () => {
    const model = getProviderModel("openrouter", "openai/gpt-6-sol");
    expect(isCustomOpenRouterModel(model)).toBe(false);
    expect(model.cost.input).toBeGreaterThan(0);
    expect(model.input).toContain("image");
  });

  it.each(["", "   ", "__custom__"])("rejects an incomplete custom selection: %j", (id) => {
    expect(() => getProviderModel("openrouter", id)).toThrow(/model ID/);
  });

  it("does not allow unknown IDs for other providers", () => {
    expect(() => getProviderModel("anthropic", "example/missing-model")).toThrow(/resolve/);
  });

  it("keeps custom OpenRouter endpoints isolated", () => {
    const model = getProviderModel("openrouter", "example/new-model", "https://relay.test/v1/");
    expect(model.baseUrl).toBe("https://relay.test/v1");
    expect(getProviderModel("openrouter", "example/new-model").baseUrl).toBe(
      "https://openrouter.ai/api/v1"
    );
  });

  it("invalidates cached local models when the endpoint is re-registered", async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "same-model" }] }),
    });

    await registerLocalModels("http://first.local/v1");
    expect(getProviderModel("local", "same-model").baseUrl).toBe("http://first.local/v1");

    await registerLocalModels("http://second.local/v1");
    expect(getProviderModel("local", "same-model").baseUrl).toBe("http://second.local/v1");
  });

  it("rejects an unknown configured model instead of silently substituting another", async () => {
    mocks.fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "served-model" }] }),
    });
    await registerLocalModels("http://local.test/v1");

    expect(() => getProviderModel("local", "missing-model")).toThrow(
      /not served by the configured local endpoint/i
    );
  });

  it("does not retain models from a stale endpoint when re-registration fails", async () => {
    mocks.fetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "old-model" }] }),
    });
    await registerLocalModels("http://old.local/v1");
    expect(getProviderModel("local", "old-model").baseUrl).toBe("http://old.local/v1");

    mocks.fetchWithTimeout.mockRejectedValueOnce(new Error("endpoint unavailable"));
    await expect(registerLocalModels("http://new.local/v1")).resolves.toEqual([]);
    expect(() => getProviderModel("local", "old-model")).toThrow(/not served/i);
  });
});
