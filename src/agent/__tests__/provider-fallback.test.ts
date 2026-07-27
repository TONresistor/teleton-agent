import { describe, expect, it } from "vitest";
import { AgentConfigSchema } from "../../config/schema.js";
import { resolveProviderFallback } from "../provider-fallback.js";

const primary = AgentConfigSchema.parse({
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  api_key: "primary-key",
  fallbacks: [{ provider: "codex", model: "gpt-5.6-terra" }],
});

describe("provider fallback", () => {
  it.each(["429 rate limit", "usage limit reached", "503 overloaded"])(
    "selects the next fallback for a transient failure: %s",
    (message) => {
      const resolved = resolveProviderFallback(primary, 0, message, false);
      expect(resolved).toMatchObject({
        provider: "codex",
        nextIndex: 1,
        config: { provider: "codex", model: "gpt-5.6-terra", fallbacks: [] },
      });
    }
  );

  it("never falls back after an external action has started", () => {
    expect(resolveProviderFallback(primary, 0, "429 rate limit", true)).toBeNull();
  });

  it("never falls back for auth or request errors", () => {
    expect(resolveProviderFallback(primary, 0, "401 unauthorized", false)).toBeNull();
  });
});
