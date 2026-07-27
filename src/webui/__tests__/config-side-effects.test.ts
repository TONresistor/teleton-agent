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

// Mock readRawConfig and writeRawConfig, keep everything else real
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

// Mock the side-effect targets
const mockSetTonapiKey = vi.fn();
const mockSetToncenterApiKey = vi.fn();
const mockInvalidateEndpointCache = vi.fn();
const mockInvalidateTonClientCache = vi.fn();

vi.mock("../../constants/api-endpoints.js", () => ({
  setTonapiKey: (...args: any[]) => mockSetTonapiKey(...args),
}));
vi.mock("../../ton/endpoint.js", () => ({
  setToncenterApiKey: (...args: any[]) => mockSetToncenterApiKey(...args),
  invalidateEndpointCache: (...args: any[]) => mockInvalidateEndpointCache(...args),
}));
vi.mock("../../ton/wallet-service.js", () => ({
  invalidateTonClientCache: (...args: any[]) => mockInvalidateTonClientCache(...args),
}));

import { createConfigRoutes } from "../routes/config.js";
import type { WebUIServerDeps } from "../types.js";

function createTestApp(
  mockConfig: Record<string, any>,
  runtime?: { reloadConfig: () => any; applyConfigKey: (key: string, value: unknown) => void }
) {
  const deps = {
    configPath: "/tmp/test.yaml",
    agent: {
      getConfig: () => mockConfig,
    },
    ...runtime,
  } as unknown as WebUIServerDeps;

  const app = new Hono();
  app.route("/api/config", createConfigRoutes(deps));
  return app;
}

describe("Config side-effects on PUT/DELETE", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp({ agent: { api_key: "sk-test" } });
    mockReadRawConfig.mockReturnValue({ agent: { api_key: "sk-test" } });
    mockWriteRawConfig.mockImplementation(() => {});
  });

  it("PUT tonapi_key calls setTonapiKey", async () => {
    const res = await app.request("/api/config/tonapi_key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "test-key-12345" }),
    });
    expect(res.status).toBe(200);
    expect(mockSetTonapiKey).toHaveBeenCalledWith("test-key-12345");
  });

  it("PUT toncenter_api_key calls all three setters", async () => {
    const res = await app.request("/api/config/toncenter_api_key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "toncenter-key-123" }),
    });
    expect(res.status).toBe(200);
    expect(mockSetToncenterApiKey).toHaveBeenCalledWith("toncenter-key-123");
    expect(mockInvalidateEndpointCache).toHaveBeenCalled();
    expect(mockInvalidateTonClientCache).toHaveBeenCalled();
  });

  it("DELETE tonapi_key calls setTonapiKey(undefined)", async () => {
    const res = await app.request("/api/config/tonapi_key", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(mockSetTonapiKey).toHaveBeenCalledWith(undefined);
  });

  it("DELETE toncenter_api_key calls all three with undefined", async () => {
    const res = await app.request("/api/config/toncenter_api_key", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(mockSetToncenterApiKey).toHaveBeenCalledWith(undefined);
    expect(mockInvalidateEndpointCache).toHaveBeenCalled();
    expect(mockInvalidateTonClientCache).toHaveBeenCalled();
  });

  it("PUT a non-side-effect key does NOT call any setter", async () => {
    const res = await app.request("/api/config/agent.temperature", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "0.7" }),
    });
    expect(res.status).toBe(200);
    expect(mockSetTonapiKey).not.toHaveBeenCalled();
    expect(mockSetToncenterApiKey).not.toHaveBeenCalled();
    expect(mockInvalidateEndpointCache).not.toHaveBeenCalled();
    expect(mockInvalidateTonClientCache).not.toHaveBeenCalled();
  });

  it("DELETE reapplies the validated schema default instead of leaving undefined", async () => {
    const applyConfigKey = vi.fn();
    app = createTestApp(
      { agent: { max_agentic_iterations: 7 } },
      {
        reloadConfig: () => ({ agent: { max_agentic_iterations: 5 } }),
        applyConfigKey,
      }
    );
    mockReadRawConfig.mockReturnValue({ agent: { max_agentic_iterations: 7 } });

    const res = await app.request("/api/config/agent.max_agentic_iterations", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(applyConfigKey).toHaveBeenCalledWith("agent.max_agentic_iterations", 5);
  });

  it("does not mutate runtime state for restart-only keys", async () => {
    const applyConfigKey = vi.fn();
    app = createTestApp(
      { embedding: { provider: "local" } },
      {
        reloadConfig: () => ({ embedding: { provider: "none" } }),
        applyConfigKey,
      }
    );
    mockReadRawConfig.mockReturnValue({ embedding: { provider: "local" } });

    const res = await app.request("/api/config/embedding.provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "none" }),
    });

    expect(res.status).toBe(200);
    expect(applyConfigKey).not.toHaveBeenCalled();
  });
});
