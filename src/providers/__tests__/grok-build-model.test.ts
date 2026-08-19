import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModelsForProvider } from "../../config/model-catalog.js";
import { getProviderMetadata } from "../../config/providers.js";
import { getProviderModel } from "../model-resolver.js";

describe("Grok Build models", () => {
  beforeEach(() => {
    process.env.GROK_CLIENT_VERSION = "1.0.5";
  });

  afterEach(() => {
    delete process.env.GROK_CLIENT_VERSION;
  });

  it("defaults to Grok 4.6 while retaining Grok 4.5", () => {
    const metadata = getProviderMetadata("grok-build");
    const modelIds = getModelsForProvider("grok-build").map((model) => model.value);

    expect(metadata.defaultModel).toBe("grok-4.6");
    expect(metadata.utilityModel).toBe("grok-4.6");
    expect(modelIds).toEqual(["grok-4.6", "grok-4.5"]);
  });

  it.each(["grok-4.6", "grok-4.5"])("resolves %s through the CLI proxy", (modelId) => {
    const model = getProviderModel("grok-build", modelId);

    expect(model.id).toBe(modelId);
    expect(model.name).toBe(modelId === "grok-4.6" ? "Grok 4.6" : "Grok 4.5");
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://cli-chat-proxy.grok.com/v1");
    expect(model.headers).toMatchObject({
      "X-XAI-Token-Auth": "xai-grok-cli",
      "x-grok-model-override": modelId,
      "x-grok-client-version": "1.0.5",
    });
  });

  it("maps the legacy grok-build model ID to Grok 4.6", () => {
    expect(getProviderModel("grok-build", "grok-build").id).toBe("grok-4.6");
  });
});
