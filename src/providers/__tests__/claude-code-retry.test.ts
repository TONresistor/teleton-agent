import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ── Test fixtures ───────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `claude-retry-test-${randomBytes(8).toString("hex")}`);
const CREDS_FILE = join(TEST_DIR, ".credentials.json");

function validCredentials(token = "sk-ant-oat01-test-token") {
  return {
    claudeAiOauth: {
      accessToken: token,
      refreshToken: "sk-ant-ort01-refresh",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["user:inference"],
    },
  };
}

function writeCredsFile(data: unknown) {
  writeFileSync(CREDS_FILE, JSON.stringify(data), "utf-8");
}

// ── Mock pi-ai complete ─────────────────────────────────────────────────

const mockComplete = vi.fn();
vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
  return {
    ...actual,
    complete: (...args: unknown[]) => mockComplete(...args),
  };
});

// ── Env management ──────────────────────────────────────────────────────

const envKeysToClean: string[] = [];

function setEnv(key: string, value: string) {
  process.env[key] = value;
  envKeysToClean.push(key);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  setEnv("CLAUDE_CONFIG_DIR", TEST_DIR);
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of envKeysToClean) delete process.env[key];
  envKeysToClean.length = 0;
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

// ── Helpers ─────────────────────────────────────────────────────────────

function makeAssistantMessage(text: string, stopReason = "endTurn", errorMessage?: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    errorMessage,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("claude-code 401 retry", () => {
  // T12
  it("retries once on 401 and succeeds", async () => {
    writeCredsFile(validCredentials("sk-ant-oat01-first-token"));

    // First call: 401 error
    mockComplete.mockResolvedValueOnce(makeAssistantMessage("", "error", "401 Unauthorized"));
    // After refresh: write new credentials and return success
    writeCredsFile(validCredentials("sk-ant-oat01-refreshed-token"));
    mockComplete.mockResolvedValueOnce(makeAssistantMessage("Hello!", "endTurn"));

    const { chatWithContext } = await import("../../agent/client.js");
    const { _resetCache } = await import("../claude-code-credentials.js");
    _resetCache();

    const response = await chatWithContext(
      {
        provider: "claude-code",
        api_key: "",
        model: "claude-opus-4-6",
        max_tokens: 1024,
        temperature: 0.7,
        system_prompt: null,
        max_agentic_iterations: 5,
        session_reset_policy: {
          daily_reset_enabled: false,
          daily_reset_hour: 4,
          idle_expiry_enabled: false,
          idle_expiry_minutes: 1440,
        },
      },
      {
        context: { messages: [], systemPrompt: "test" },
      }
    );

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(response.text).toBe("Hello!");
  });

  // T13
  it("does not retry more than once on persistent 401", async () => {
    writeCredsFile(validCredentials());

    // Both calls return 401
    mockComplete.mockResolvedValue(makeAssistantMessage("", "error", "401 Unauthorized"));

    const { chatWithContext } = await import("../../agent/client.js");
    const { _resetCache } = await import("../claude-code-credentials.js");
    _resetCache();

    const response = await chatWithContext(
      {
        provider: "claude-code",
        api_key: "",
        model: "claude-opus-4-6",
        max_tokens: 1024,
        temperature: 0.7,
        system_prompt: null,
        max_agentic_iterations: 5,
        session_reset_policy: {
          daily_reset_enabled: false,
          daily_reset_hour: 4,
          idle_expiry_enabled: false,
          idle_expiry_minutes: 1440,
        },
      },
      {
        context: { messages: [], systemPrompt: "test" },
      }
    );

    // Should have retried exactly once (2 calls total)
    expect(mockComplete).toHaveBeenCalledTimes(2);
    // Response should still be the error (not infinite loop)
    expect(response.message.stopReason).toBe("error");
  });
});
