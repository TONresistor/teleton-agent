import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockReadRawConfig = vi.fn();
const mockWriteRawConfig = vi.fn();

vi.mock("../../config/configurable-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/configurable-keys.js")>();
  return {
    ...actual,
    readRawConfig: (...args: any[]) => mockReadRawConfig(...args),
    writeRawConfig: (...args: any[]) => mockWriteRawConfig(...args),
  };
});

import { createToolsRoutes } from "../routes/tools.js";
import type { WebUIServerDeps } from "../types.js";

function createTestApp(config: Record<string, any>) {
  const deps = {
    configPath: "/tmp/test.yaml",
    agent: {
      getConfig: () => config,
    },
    toolRegistry: {
      getAll: () => [],
      getAvailableModules: () => [],
      getModuleTools: () => [],
      getToolConfig: () => null,
      getToolCategory: () => undefined,
      getToolIndex: () => ({ isIndexed: true }),
      count: 50,
      has: () => false,
      isPluginModule: () => false,
    },
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/api/tools", createToolsRoutes(deps));
  return app;
}

function defaultConfig() {
  return {
    tool_rag: {
      enabled: false,
      top_k: 20,
      always_include: [] as string[],
      skip_unlimited_providers: false,
    },
  };
}

describe("PUT /api/tools/rag — persistence", () => {
  let config: ReturnType<typeof defaultConfig>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    config = defaultConfig();
    app = createTestApp(config);
    mockReadRawConfig.mockReturnValue({ tool_rag: { enabled: false, top_k: 20 } });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("persists enabled change to YAML", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
  });

  it("persists topK change to YAML", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topK: 30 }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
    // Verify the raw config was updated with top_k
    const rawArg = mockWriteRawConfig.mock.calls[0][0];
    expect(rawArg.tool_rag.top_k).toBe(30);
  });

  it("persists both enabled and topK together", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, topK: 15 }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
    const rawArg = mockWriteRawConfig.mock.calls[0][0];
    expect(rawArg.tool_rag.enabled).toBe(false);
    expect(rawArg.tool_rag.top_k).toBe(15);
  });
});

describe("PUT /api/tools/rag — new fields", () => {
  let config: ReturnType<typeof defaultConfig>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    config = defaultConfig();
    app = createTestApp(config);
    mockReadRawConfig.mockReturnValue({ tool_rag: { enabled: false, top_k: 20 } });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("accepts and persists alwaysInclude", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysInclude: ["telegram_send_*", "journal_*"] }),
    });
    expect(res.status).toBe(200);
    expect(config.tool_rag.always_include).toEqual(["telegram_send_*", "journal_*"]);
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
  });

  it("accepts and persists skipUnlimitedProviders", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipUnlimitedProviders: true }),
    });
    expect(res.status).toBe(200);
    expect(config.tool_rag.skip_unlimited_providers).toBe(true);
    expect(mockWriteRawConfig).toHaveBeenCalledTimes(1);
  });

  it("validates alwaysInclude is array of strings", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysInclude: "not-array" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("validates alwaysInclude items are non-empty", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysInclude: ["valid", ""] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns updated alwaysInclude in response", async () => {
    const res = await app.request("/api/tools/rag", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alwaysInclude: ["web_*"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alwaysInclude).toEqual(["web_*"]);
  });
});

describe("GET /api/tools/rag — existing behavior preserved", () => {
  it("returns alwaysInclude from config", async () => {
    const config = defaultConfig();
    config.tool_rag.always_include = ["telegram_send_*"];
    const app = createTestApp(config);

    const res = await app.request("/api/tools/rag");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.alwaysInclude).toEqual(["telegram_send_*"]);
  });

  it("returns skipUnlimitedProviders from config", async () => {
    const config = defaultConfig();
    config.tool_rag.skip_unlimited_providers = false;
    const app = createTestApp(config);

    const res = await app.request("/api/tools/rag");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.skipUnlimitedProviders).toBe(false);
  });
});
