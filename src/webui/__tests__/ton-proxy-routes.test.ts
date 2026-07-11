import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebUIServerDeps } from "../types.js";

const managerState = vi.hoisted(() => ({
  instances: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
  }>,
}));
const configState = vi.hoisted(() => ({
  readRawConfig: vi.fn(),
  writeRawConfig: vi.fn(),
}));

vi.mock("../../ton-proxy/manager.js", () => ({
  TonProxyManager: class {
    start = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);
    getStatus = vi.fn(() => ({ running: true, installed: true, port: 8080, pid: 123 }));
    isRunning = vi.fn(() => true);

    constructor() {
      managerState.instances.push(this);
    }
  },
}));

vi.mock("../../config/configurable-keys.js", () => ({
  readRawConfig: configState.readRawConfig,
  writeRawConfig: configState.writeRawConfig,
  setNestedValue: vi.fn((target: Record<string, unknown>) => target),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { getTonProxyManager, setTonProxyManager } from "../../ton-proxy/module.js";
import { createTonProxyRoutes } from "../routes/ton-proxy.js";

function createApp() {
  const runtimeConfig = { ton_proxy: { enabled: false, port: 8080 } };
  const deps = {
    configPath: "/tmp/teleton-test.yaml",
    agent: { getConfig: () => runtimeConfig },
  } as unknown as WebUIServerDeps;
  const app = new Hono();
  app.route("/api/ton-proxy", createTonProxyRoutes(deps));
  return app;
}

describe("TON Proxy WebUI lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managerState.instances.length = 0;
    setTonProxyManager(null);
    configState.readRawConfig.mockReturnValue({ ton_proxy: { enabled: false } });
  });

  it("stops a newly started process if configuration persistence fails", async () => {
    configState.writeRawConfig.mockImplementation(() => {
      throw new Error("disk full");
    });

    const response = await createApp().request("/api/ton-proxy/start", { method: "POST" });

    expect(response.status).toBe(500);
    expect(managerState.instances).toHaveLength(1);
    expect(managerState.instances[0].stop).toHaveBeenCalledOnce();
    expect(getTonProxyManager()).toBeNull();
  });
});
