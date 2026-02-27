import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ── Test fixtures ───────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `claude-creds-test-${randomBytes(8).toString("hex")}`);
const CREDS_FILE = join(TEST_DIR, ".credentials.json");

function validCredentials(overrides: Record<string, unknown> = {}) {
  return {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-test-token-abc123",
      refreshToken: "sk-ant-ort01-refresh-xyz",
      expiresAt: Date.now() + 3_600_000, // 1h from now
      scopes: ["user:inference", "user:profile"],
      ...overrides,
    },
  };
}

function expiredCredentials() {
  return validCredentials({ expiresAt: Date.now() - 60_000 }); // 1min ago
}

function writeCredsFile(data: unknown) {
  writeFileSync(CREDS_FILE, JSON.stringify(data), "utf-8");
}

// ── Env management ──────────────────────────────────────────────────────

const envKeysToClean: string[] = [];

function setEnv(key: string, value: string) {
  process.env[key] = value;
  envKeysToClean.push(key);
}

// ── Setup / Teardown ────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  setEnv("CLAUDE_CONFIG_DIR", TEST_DIR);
});

afterEach(async () => {
  for (const key of envKeysToClean) delete process.env[key];
  envKeysToClean.length = 0;
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
  // Reset module to clear cached state
  vi.resetModules();
});

// ── Helper: fresh import ────────────────────────────────────────────────

async function importModule() {
  return import("../claude-code-credentials.js");
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("claude-code-credentials", () => {
  // T1
  it("reads valid credentials from .credentials.json", async () => {
    writeCredsFile(validCredentials());
    const mod = await importModule();
    const key = mod.getClaudeCodeApiKey();
    expect(key).toBe("sk-ant-oat01-test-token-abc123");
  });

  // T2
  it("throws when no credentials file and no fallback", async () => {
    const mod = await importModule();
    expect(() => mod.getClaudeCodeApiKey()).toThrow(/No Claude Code credentials found/);
  });

  // T3
  it("falls back to manual key on malformed JSON", async () => {
    writeFileSync(CREDS_FILE, "NOT VALID JSON{{{", "utf-8");
    const mod = await importModule();
    const key = mod.getClaudeCodeApiKey("sk-ant-api03-fallback");
    expect(key).toBe("sk-ant-api03-fallback");
  });

  // T4
  it("falls back when claudeAiOauth field is missing", async () => {
    writeCredsFile({ someOtherKey: "value" });
    const mod = await importModule();
    const key = mod.getClaudeCodeApiKey("sk-ant-api03-fallback");
    expect(key).toBe("sk-ant-api03-fallback");
  });

  // T5
  it("caches token and does not re-read on second call", async () => {
    writeCredsFile(validCredentials());
    const mod = await importModule();

    const key1 = mod.getClaudeCodeApiKey();
    // Overwrite file with different token
    writeCredsFile(validCredentials({ accessToken: "sk-ant-oat01-different" }));
    const key2 = mod.getClaudeCodeApiKey();

    // Should still return cached token
    expect(key1).toBe(key2);
    expect(key2).toBe("sk-ant-oat01-test-token-abc123");
  });

  // T6
  it("re-reads file when cached token is expired", async () => {
    writeCredsFile(expiredCredentials());
    const mod = await importModule();

    // First call reads expired token — it still returns it (just read)
    const key1 = mod.getClaudeCodeApiKey();
    expect(key1).toBe("sk-ant-oat01-test-token-abc123");

    // Now token is cached but expired, write new token
    writeCredsFile(validCredentials({ accessToken: "sk-ant-oat01-refreshed" }));
    const key2 = mod.getClaudeCodeApiKey();
    expect(key2).toBe("sk-ant-oat01-refreshed");
  });

  // T7
  it("refreshClaudeCodeApiKey clears cache and re-reads", async () => {
    writeCredsFile(validCredentials());
    const mod = await importModule();

    const key1 = mod.getClaudeCodeApiKey();
    expect(key1).toBe("sk-ant-oat01-test-token-abc123");

    // Write new token and force refresh
    writeCredsFile(validCredentials({ accessToken: "sk-ant-oat01-new-token" }));
    const key2 = mod.refreshClaudeCodeApiKey();
    expect(key2).toBe("sk-ant-oat01-new-token");
  });

  // T8
  it("respects CLAUDE_CONFIG_DIR override", async () => {
    const customDir = join(tmpdir(), `claude-custom-${randomBytes(4).toString("hex")}`);
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      join(customDir, ".credentials.json"),
      JSON.stringify(validCredentials({ accessToken: "sk-ant-oat01-custom-dir" })),
      "utf-8"
    );

    // Override the env
    setEnv("CLAUDE_CONFIG_DIR", customDir);
    const mod = await importModule();
    const key = mod.getClaudeCodeApiKey();
    expect(key).toBe("sk-ant-oat01-custom-dir");

    rmSync(customDir, { recursive: true, force: true });
  });

  // T9
  it("falls back to manual api_key when no credentials", async () => {
    const mod = await importModule();
    const key = mod.getClaudeCodeApiKey("sk-ant-api03-manual-key");
    expect(key).toBe("sk-ant-api03-manual-key");
  });

  // T10
  it("isClaudeCodeTokenValid returns true for valid cached token", async () => {
    writeCredsFile(validCredentials());
    const mod = await importModule();
    mod.getClaudeCodeApiKey(); // populate cache
    expect(mod.isClaudeCodeTokenValid()).toBe(true);
  });

  // T11
  it("isClaudeCodeTokenValid returns false when no cached token", async () => {
    const mod = await importModule();
    expect(mod.isClaudeCodeTokenValid()).toBe(false);
  });

  // T12
  it("refreshClaudeCodeApiKey returns null when no credentials available", async () => {
    const mod = await importModule();
    const result = mod.refreshClaudeCodeApiKey();
    expect(result).toBeNull();
  });

  // T13
  it("_resetCache clears the cache", async () => {
    writeCredsFile(validCredentials());
    const mod = await importModule();
    mod.getClaudeCodeApiKey();
    expect(mod.isClaudeCodeTokenValid()).toBe(true);
    mod._resetCache();
    expect(mod.isClaudeCodeTokenValid()).toBe(false);
  });
});
