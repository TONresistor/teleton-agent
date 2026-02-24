import { describe, it, expect } from "vitest";
import {
  getProviderMetadata,
  validateApiKeyFormat,
  getSupportedProviders,
} from "../../config/providers.js";
import { AgentConfigSchema } from "../../config/schema.js";

describe("claude-code provider registration", () => {
  // T14
  it("is registered with correct metadata", () => {
    const meta = getProviderMetadata("claude-code");
    expect(meta.id).toBe("claude-code");
    expect(meta.displayName).toBe("Claude Code (Auto)");
    expect(meta.piAiProvider).toBe("anthropic");
    expect(meta.toolLimit).toBeNull();
    expect(meta.defaultModel).toBe("claude-opus-4-6");
    expect(meta.utilityModel).toBe("claude-3-5-haiku-20241022");
    expect(meta.keyPrefix).toBe("sk-ant-");
  });

  it("appears in getSupportedProviders()", () => {
    const providers = getSupportedProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("claude-code");
  });

  it("has identical API config to anthropic except display", () => {
    const anthropic = getProviderMetadata("anthropic");
    const claudeCode = getProviderMetadata("claude-code");

    expect(claudeCode.piAiProvider).toBe(anthropic.piAiProvider);
    expect(claudeCode.toolLimit).toBe(anthropic.toolLimit);
    expect(claudeCode.defaultModel).toBe(anthropic.defaultModel);
    expect(claudeCode.utilityModel).toBe(anthropic.utilityModel);
    expect(claudeCode.envVar).toBe(anthropic.envVar);
    expect(claudeCode.keyPrefix).toBe(anthropic.keyPrefix);
  });

  // T15
  it("is accepted by AgentConfigSchema", () => {
    const result = AgentConfigSchema.safeParse({ provider: "claude-code" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("claude-code");
    }
  });

  it("skips api key validation for claude-code (auto-detects)", () => {
    // claude-code is exempt from key validation — credentials are auto-detected
    expect(validateApiKeyFormat("claude-code", "sk-ant-api03-valid")).toBeUndefined();
    expect(validateApiKeyFormat("claude-code", "sk-ant-oat01-oauth")).toBeUndefined();
    expect(validateApiKeyFormat("claude-code", "invalid-key")).toBeUndefined();
    expect(validateApiKeyFormat("claude-code", "")).toBeUndefined();
  });
});
