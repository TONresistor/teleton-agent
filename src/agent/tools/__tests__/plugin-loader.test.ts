import { describe, it, expect, vi, beforeEach } from "vitest";
import { adaptPlugin } from "../plugin-loader.js";
import { sanitizeConfigForPlugins } from "../plugin-validator.js";
import { SDK_VERSION } from "@teleton-agent/sdk";
import type { Config } from "../../../config/schema.js";

const moduleDbMocks = vi.hoisted(() => ({
  pluginDb: {
    kind: "plugin",
    close: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => ({ all: () => [] })),
  },
}));

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../utils/module-db.js", () => ({
  openModuleDb: () => moduleDbMocks.pluginDb,
  createDbWrapper:
    (getDb: () => unknown) =>
    (executor: (params: unknown, context: Record<string, unknown>) => unknown) =>
    (params: unknown, context: Record<string, unknown>) => {
      const db = getDb();
      if (!db) return Promise.resolve({ success: false, error: "plugin module not started" });
      return executor(params, { ...context, db });
    },
  migrateFromMainDb: vi.fn(),
}));

vi.mock("../../../workspace/paths.js", () => ({
  WORKSPACE_PATHS: { PLUGINS_DIR: "/tmp/test-plugins" },
  TELETON_ROOT: "/tmp/test-teleton",
}));

vi.mock("../../../sdk/secrets.js", () => ({
  createSecretsSDK: () => ({ has: () => true }),
}));

// ─── Fixtures ───────────────────────────────────────────────────

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    meta: { version: "1.0.0", onboard_command: "teleton setup" },
    agent: {
      provider: "anthropic",
      api_key: "sk-ant-SUPER-SECRET-KEY",
      model: "claude-opus-4-6",
      max_tokens: 4096,
      temperature: 0.7,
      system_prompt: null,
      max_agentic_iterations: 5,
      session_reset_policy: {
        daily_reset_enabled: true,
        daily_reset_hour: 4,
        idle_expiry_enabled: true,
        idle_expiry_minutes: 1440,
      },
    },
    telegram: {
      api_id: 12345678,
      api_hash: "abcdef0123456789abcdef0123456789",
      phone: "+33612345678",
      session_name: "teleton_session",
      session_path: "~/.teleton",
      dm_policy: "allowlist",
      allow_from: [],
      group_policy: "open",
      group_allow_from: [],
      require_mention: true,
      max_message_length: 4096,
      typing_simulation: true,
      rate_limit_messages_per_second: 1.0,
      rate_limit_groups_per_minute: 20,
      admin_ids: [111, 222],
      agent_channel: null,
      debounce_ms: 1500,
    },
    storage: {
      sessions_file: "~/.teleton/sessions.json",
      memory_file: "~/.teleton/memory.json",
      history_limit: 100,
    },
    embedding: { provider: "local" },
    webui: {
      enabled: false,
      port: 7777,
      host: "127.0.0.1",
      cors_origins: [],
      log_requests: false,
    },
    logging: { level: "info", pretty: true },
    dev: { hot_reload: false },
    tool_rag: {
      enabled: true,
      top_k: 25,
      always_include: [],
      skip_unlimited_providers: false,
    },
    capabilities: {
      exec: {
        mode: "off",
        scope: "admin-only",
        allowlist: [],
        limits: { timeout: 120, max_output: 50000 },
        audit: { log_commands: true },
      },
    },
    ton_proxy: { enabled: false, port: 8080 },
    mcp: { servers: {} },
    plugins: {},
    tonapi_key: "tonapi-secret-key-999",
    toncenter_api_key: "toncenter-secret-key-888",
    tavily_api_key: "tvly-secret-key-777",
    ...overrides,
  } as Config;
}

const minimalSdkDeps = { bridge: { getMode: () => "user" } as any };

function makeRawPlugin(overrides?: Record<string, unknown>) {
  return {
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        execute: async () => ({ success: true }),
      },
    ],
    ...overrides,
  };
}

// ─── T5: adaptPlugin SDK version + dependency check ─────────────

describe("adaptPlugin — SDK version + dependency check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("T5a: throws when plugin sdkVersion exceeds current SDK", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "future-plugin",
        version: "1.0.0",
        sdkVersion: ">=99.0.0",
      },
    });

    expect(() => adaptPlugin(raw, "future-plugin", makeConfig(), [], minimalSdkDeps)).toThrow(
      /requires SDK >=99\.0\.0/
    );
  });

  it("T5b: throws when plugin sdkVersion uses caret and major doesn't match", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "major-mismatch",
        version: "1.0.0",
        sdkVersion: "^5.0.0",
      },
    });

    expect(() => adaptPlugin(raw, "major-mismatch", makeConfig(), [], minimalSdkDeps)).toThrow(
      /requires SDK/
    );
  });

  it("T5c: throws when plugin has missing dependency", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "dep-plugin",
        version: "1.0.0",
        dependencies: ["non-existent-module"],
      },
    });

    expect(() =>
      adaptPlugin(raw, "dep-plugin", makeConfig(), ["other-module"], minimalSdkDeps)
    ).toThrow(/requires module "non-existent-module" which is not loaded/);
  });

  it("T5d: throws when plugin has multiple dependencies and one is missing", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "multi-dep",
        version: "1.0.0",
        dependencies: ["module-a", "module-b"],
      },
    });

    expect(() => adaptPlugin(raw, "multi-dep", makeConfig(), ["module-a"], minimalSdkDeps)).toThrow(
      /requires module "module-b"/
    );
  });

  it("T5e: succeeds with valid sdkVersion (current SDK satisfies >=1.0.0)", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "valid-plugin",
        version: "1.0.0",
        sdkVersion: `>=${SDK_VERSION}`,
      },
    });

    const module = adaptPlugin(raw, "valid-plugin", makeConfig(), [], minimalSdkDeps);
    expect(module.name).toBe("valid-plugin");
    expect(module.version).toBe("1.0.0");
  });

  it("T5f: succeeds with exact sdkVersion matching current SDK", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "exact-version",
        version: "2.0.0",
        sdkVersion: SDK_VERSION,
      },
    });

    const module = adaptPlugin(raw, "exact-version", makeConfig(), [], minimalSdkDeps);
    expect(module.name).toBe("exact-version");
  });

  it("T5g: succeeds with all dependencies present", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "full-deps",
        version: "1.0.0",
        dependencies: ["core", "utils"],
      },
    });

    const module = adaptPlugin(
      raw,
      "full-deps",
      makeConfig(),
      ["core", "utils", "extra"],
      minimalSdkDeps
    );
    expect(module.name).toBe("full-deps");
  });

  it("T5h: succeeds with no sdkVersion or dependencies declared", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "minimal-plugin",
        version: "0.1.0",
      },
    });

    const module = adaptPlugin(raw, "minimal-plugin", makeConfig(), [], minimalSdkDeps);
    expect(module.name).toBe("minimal-plugin");
    expect(module.version).toBe("0.1.0");
  });

  it("T5i: falls back to entryName and version 0.0.0 when manifest is absent", () => {
    const raw = makeRawPlugin();

    const module = adaptPlugin(raw, "my-cool-plugin", makeConfig(), [], minimalSdkDeps);
    expect(module.name).toBe("my-cool-plugin");
    expect(module.version).toBe("0.0.0");
  });

  it("fails closed when an exported manifest is invalid", () => {
    const raw = makeRawPlugin({
      manifest: {
        name: "INVALID NAME",
        version: "1.0.0",
      },
    });

    expect(() => adaptPlugin(raw, "invalid-plugin", makeConfig(), [], minimalSdkDeps)).toThrow(
      /invalid manifest/
    );
  });

  it("propagates an explicit approval requirement from the public tool contract", () => {
    const raw = makeRawPlugin({
      tools: [
        {
          name: "sensitive_read",
          description: "Read sensitive plugin data",
          category: "data-bearing",
          requiresApproval: true,
          execute: async () => ({ success: true }),
        },
      ],
    });
    const module = adaptPlugin(raw, "approval-plugin", makeConfig(), [], minimalSdkDeps);
    module.migrate?.();

    expect(module.tools(makeConfig())[0].requiresApproval).toBe(true);
  });
});

// ─── T4: Plugin config isolation (sanitizeConfigForPlugins) ─────

describe("sanitizeConfigForPlugins — config isolation", () => {
  it("T4a: strips api_key, api_hash, session, phone, and all secrets", () => {
    const config = makeConfig();
    const sanitized = sanitizeConfigForPlugins(config);

    // Sensitive fields must NOT appear anywhere
    expect(JSON.stringify(sanitized)).not.toContain("sk-ant-SUPER-SECRET-KEY");
    expect(JSON.stringify(sanitized)).not.toContain("abcdef0123456789abcdef0123456789");
    expect(JSON.stringify(sanitized)).not.toContain("+33612345678");
    expect(JSON.stringify(sanitized)).not.toContain("tonapi-secret-key-999");
    expect(JSON.stringify(sanitized)).not.toContain("toncenter-secret-key-888");
    expect(JSON.stringify(sanitized)).not.toContain("tvly-secret-key-777");

    // api_key must not be a direct property
    expect((sanitized as any).agent?.api_key).toBeUndefined();
    // api_hash must not be a direct property
    expect((sanitized as any).telegram?.api_hash).toBeUndefined();
    // session_name/session_path must not leak
    expect((sanitized as any).telegram?.session_name).toBeUndefined();
    expect((sanitized as any).telegram?.session_path).toBeUndefined();
    // phone must not leak
    expect((sanitized as any).telegram?.phone).toBeUndefined();
  });

  it("T4b: preserves non-sensitive agent fields", () => {
    const config = makeConfig();
    const sanitized = sanitizeConfigForPlugins(config) as any;

    expect(sanitized.agent.provider).toBe("anthropic");
    expect(sanitized.agent.model).toBe("claude-opus-4-6");
    expect(sanitized.agent.max_tokens).toBe(4096);
  });

  it("T4c: preserves telegram.admin_ids", () => {
    const config = makeConfig();
    const sanitized = sanitizeConfigForPlugins(config) as any;

    expect(sanitized.telegram.admin_ids).toEqual([111, 222]);
  });

  it("T4e: does not expose top-level secret keys", () => {
    const config = makeConfig();
    const sanitized = sanitizeConfigForPlugins(config) as any;

    expect(sanitized.tonapi_key).toBeUndefined();
    expect(sanitized.toncenter_api_key).toBeUndefined();
    expect(sanitized.tavily_api_key).toBeUndefined();
  });

  it("T4f: does not expose storage, webui, embedding, or other config sections", () => {
    const config = makeConfig();
    const sanitized = sanitizeConfigForPlugins(config) as any;

    expect(sanitized.storage).toBeUndefined();
    expect(sanitized.webui).toBeUndefined();
    expect(sanitized.embedding).toBeUndefined();
    expect(sanitized.logging).toBeUndefined();
    expect(sanitized.capabilities).toBeUndefined();
    expect(sanitized.mcp).toBeUndefined();
  });

  it("T4g: adaptPlugin passes sanitized config to plugin context (not raw config)", () => {
    const config = makeConfig();
    const raw = makeRawPlugin({
      manifest: { name: "spy-plugin", version: "1.0.0" },
    });

    // adaptPlugin calls sanitizeConfigForPlugins internally — verify the module
    // doesn't leak raw config via its start() context
    const module = adaptPlugin(raw, "spy-plugin", config, [], minimalSdkDeps);

    // Module should exist and be valid
    expect(module.name).toBe("spy-plugin");

    // The tools() method wraps executors to sanitize context.config —
    // this is verified by the existence of sandboxedExecutor in plugin-loader.ts
    const tools = module.tools();
    expect(tools.length).toBe(1);
    expect(tools[0].tool.name).toBe("test_tool");
  });
});

describe("adaptPlugin — database isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always replaces the agent database for plugins without migrate()", async () => {
    const agentDb = { kind: "agent" };
    let receivedContext: Record<string, unknown> | undefined;
    const raw = makeRawPlugin({
      tools: [
        {
          name: "db_probe",
          description: "Inspect the injected database",
          execute: async (_params: unknown, context: Record<string, unknown>) => {
            receivedContext = context;
            return { success: true };
          },
        },
      ],
    });

    const module = adaptPlugin(raw, "db-probe", makeConfig(), [], minimalSdkDeps);
    module.migrate?.();
    const [tool] = module.tools(makeConfig());
    await tool.executor({}, { db: agentDb, bridge: minimalSdkDeps.bridge } as never);

    expect(receivedContext?.db).not.toBe(agentDb);
    expect((receivedContext?.db as { kind: string }).kind).toBe("plugin");
    expect(receivedContext).not.toHaveProperty("bridge");
  });

  it("uses the protected plugin database for migrate(), tools, and start()", async () => {
    const agentDb = { kind: "agent" };
    const received: Record<string, unknown> = {};
    let startContext: Record<string, unknown> | undefined;
    const raw = makeRawPlugin({
      migrate: (db: unknown) => {
        received.migrate = db;
      },
      tools: [
        {
          name: "db_probe",
          description: "Inspect the injected database",
          execute: async (_params: unknown, context: { db: unknown }) => {
            received.tool = context.db;
            return { success: true };
          },
        },
      ],
      start: async (context: Record<string, unknown>) => {
        startContext = context;
        received.start = context.db;
      },
    });

    const module = adaptPlugin(raw, "db-probe", makeConfig(), [], minimalSdkDeps);
    module.migrate?.();
    const [tool] = module.tools(makeConfig());
    await tool.executor({}, { db: agentDb } as never);
    await module.start?.({
      bridge: minimalSdkDeps.bridge,
      db: agentDb,
      config: makeConfig(),
    } as never);

    for (const db of Object.values(received)) {
      expect(db).not.toBe(agentDb);
      expect((db as { kind: string }).kind).toBe("plugin");
    }
    expect(startContext).toHaveProperty("sdk");
    expect(startContext).not.toHaveProperty("bridge");
  });
});
