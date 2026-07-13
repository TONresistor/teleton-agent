import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock("../../utils/fetch.js", () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

import { getProviderModel, registerLocalModels } from "../model-resolver.js";

describe("dynamic model registry", () => {
  beforeEach(() => mocks.fetchWithTimeout.mockReset());

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
