import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../loader.js";
import { createEmbeddingProvider } from "../../memory/embeddings/index.js";

vi.mock("../../memory/embeddings/local.js", () => ({ LocalEmbeddingProvider: class {} }));

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-embedding-config-"));
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("TELETON_")))
    vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function configuration(embedding: string) {
  const path = join(directory, "config.yaml");
  writeFileSync(
    path,
    `agent:\n  provider: anthropic\n  api_key: test-agent-key\ntelegram:\n  api_id: 12345\n  api_hash: test-hash\n  phone: "+1234567890"\nembedding:\n${embedding}\n`
  );
  return loadConfig(path);
}

describe("dedicated Voyage embedding configuration", () => {
  it("migrates the legacy provider alias while keeping separate credentials", () => {
    const config = configuration(
      "  provider: anthropic\n  api_key: test-voyage-key\n  model: voyage-3-lite"
    );
    expect(config.embedding).toMatchObject({
      provider: "voyage",
      api_key: "test-voyage-key",
      model: "voyage-3-lite",
    });
    expect(config.agent.api_key).toBe("test-agent-key");
  });

  it("applies the dedicated environment override independently of the agent key", () => {
    vi.stubEnv("TELETON_EMBEDDING_API_KEY", "environment-voyage-key");
    vi.stubEnv("TELETON_API_KEY", "environment-agent-key");
    const config = configuration("  provider: voyage\n  api_key: config-voyage-key");
    expect(config.embedding.api_key).toBe("environment-voyage-key");
    expect(config.agent.api_key).toBe("environment-agent-key");
  });

  it("does not implicitly send the agent credential to Voyage", () => {
    const config = configuration("  provider: voyage");
    expect(config.embedding.api_key).toBeUndefined();
    expect(() =>
      createEmbeddingProvider({ provider: "voyage", apiKey: config.embedding.api_key })
    ).toThrow("TELETON_EMBEDDING_API_KEY");
  });

  it("uses the known model width and honors an explicitly configured output width", () => {
    expect(
      createEmbeddingProvider({ provider: "voyage", model: "voyage-3-lite", apiKey: "test-key" })
        .dimensions
    ).toBe(512);
    expect(
      createEmbeddingProvider({
        provider: "voyage",
        model: "voyage-4",
        apiKey: "test-key",
        dimensions: 256,
      }).dimensions
    ).toBe(256);
  });
});
