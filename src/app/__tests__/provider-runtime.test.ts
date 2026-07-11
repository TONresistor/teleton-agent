import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({ registerLocalModels: vi.fn() }));

vi.mock("../../agent/client.js", () => ({ registerLocalModels: mocks.registerLocalModels }));

import { ProviderRuntime } from "../provider-runtime.js";

function localConfig(baseUrl: string): Config {
  return {
    agent: { provider: "local", base_url: baseUrl, model: "auto" },
  } as Config;
}

describe("ProviderRuntime", () => {
  beforeEach(() => {
    mocks.registerLocalModels.mockReset();
    mocks.registerLocalModels.mockResolvedValue(["model-a"]);
  });

  it("uses the latest reloaded config object", async () => {
    const initial = localConfig("http://old.local/v1");
    const reloaded = localConfig("http://new.local/v1");
    const runtime = new ProviderRuntime(initial);

    runtime.updateConfig(reloaded);
    await runtime.initialize();

    expect(mocks.registerLocalModels).toHaveBeenCalledWith("http://new.local/v1");
    expect(reloaded.agent.model).toBe("model-a");
    expect(initial.agent.model).toBe("auto");
  });
});
