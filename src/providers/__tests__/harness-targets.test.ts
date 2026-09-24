import { afterEach, expect, it, vi } from "vitest";
import { registerLocalModels, getProviderModel, getUtilityModel } from "../model-resolver.js";
import { ProviderRuntime } from "../../app/provider-runtime.js";
import { ConfigSchema } from "../../config/schema.js";
afterEach(() => vi.unstubAllGlobals());
it("keeps identical local model IDs separate by endpoint and resolves the default utility model", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "model" }] })))
  );
  await registerLocalModels("http://primary.invalid/v1");
  await registerLocalModels("http://fallback.invalid/v1", false);
  expect(getProviderModel("local", "model", "http://primary.invalid/v1").baseUrl).toBe(
    "http://primary.invalid/v1"
  );
  expect(getProviderModel("local", "model", "http://fallback.invalid/v1").baseUrl).toBe(
    "http://fallback.invalid/v1"
  );
  expect(getUtilityModel("local").id).toBe("model");
});
it("initializes a local fallback without making it the primary target", async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ data: [{ id: "fallback-model" }] }))
  );
  vi.stubGlobal("fetch", fetch);
  const cfg = ConfigSchema.parse({
    agent: {
      provider: "anthropic",
      api_key: "fake",
      fallbacks: [
        { provider: "local", model: "fallback-model", base_url: "http://fallback.invalid/v1" },
      ],
    },
    telegram: { mode: "bot", bot_token: "123:test", owner_id: 1, admin_ids: [1] },
  });
  await new ProviderRuntime(cfg).initialize();
  expect(fetch).toHaveBeenCalledOnce();
  expect(cfg.agent.provider).toBe("anthropic");
  expect(getProviderModel("local", "fallback-model", "http://fallback.invalid/v1").id).toBe(
    "fallback-model"
  );
});
