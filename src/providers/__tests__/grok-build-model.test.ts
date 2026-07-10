import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";
import { getProviderModel } from "../model-resolver.js";

describe("Grok Build model", () => {
  beforeEach(() => {
    process.env.GROK_CLIENT_VERSION = "0.2.77";
  });

  afterEach(() => {
    delete process.env.GROK_CLIENT_VERSION;
    vi.unstubAllGlobals();
  });

  it("uses the CLI proxy Responses endpoint and required headers", () => {
    const model = getProviderModel("grok-build", "grok-build");

    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://cli-chat-proxy.grok.com/v1");
    expect(model.headers).toMatchObject({
      "X-XAI-Token-Auth": "xai-grok-cli",
      "x-grok-model-override": "grok-build",
      "x-grok-client-version": "0.2.77",
    });
    expect(model.reasoning).toBe(false);
    expect(model.contextWindow).toBe(500_000);
  });

  it("sends the CLI session headers to the Responses endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "test stop" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = getProviderModel("grok-build", "grok-build");
    await complete(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      {
        apiKey: "local-session-token",
        cacheRetention: "none",
      }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://cli-chat-proxy.grok.com/v1/responses");
    expect(headers.get("authorization")).toBe("Bearer local-session-token");
    expect(headers.get("x-xai-token-auth")).toBe("xai-grok-cli");
    expect(headers.get("x-grok-model-override")).toBe("grok-build");
    expect(headers.get("x-grok-client-version")).toBe("0.2.77");

    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      model: "grok-build",
      stream: true,
      store: false,
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("prompt_cache_key");
  });
});
