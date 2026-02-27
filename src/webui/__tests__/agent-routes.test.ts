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

import { AgentLifecycle } from "../../agent/lifecycle.js";

// Build a minimal Hono app that mirrors the agent routes from server.ts
function createTestApp(lifecycle?: AgentLifecycle) {
  const app = new Hono();

  // Simulate auth middleware: all requests are authenticated (we test auth separately)
  app.post("/api/agent/start", async (c) => {
    if (!lifecycle) {
      return c.json({ error: "Agent lifecycle not available" }, 503);
    }
    const state = lifecycle.getState();
    if (state === "running") {
      return c.json({ state: "running" }, 409);
    }
    if (state === "stopping") {
      return c.json({ error: "Agent is currently stopping, please wait" }, 409);
    }
    lifecycle.start().catch(() => {});
    return c.json({ state: "starting" });
  });

  app.post("/api/agent/stop", async (c) => {
    if (!lifecycle) {
      return c.json({ error: "Agent lifecycle not available" }, 503);
    }
    const state = lifecycle.getState();
    if (state === "stopped") {
      return c.json({ state: "stopped" }, 409);
    }
    if (state === "starting") {
      return c.json({ error: "Agent is currently starting, please wait" }, 409);
    }
    lifecycle.stop().catch(() => {});
    return c.json({ state: "stopping" });
  });

  app.get("/api/agent/status", (c) => {
    if (!lifecycle) {
      return c.json({ error: "Agent lifecycle not available" }, 503);
    }
    return c.json({
      state: lifecycle.getState(),
      uptime: lifecycle.getUptime(),
      error: lifecycle.getError() ?? null,
    });
  });

  return app;
}

describe("Agent Lifecycle API Routes", () => {
  let lifecycle: AgentLifecycle;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(
      async () => {},
      async () => {}
    );
    app = createTestApp(lifecycle);
  });

  // 1. POST /api/agent/start — agent stopped
  it("POST /api/agent/start returns 200 with starting when agent stopped", async () => {
    const res = await app.request("/api/agent/start", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("starting");
  });

  // 2. POST /api/agent/start — agent already running
  it("POST /api/agent/start returns 409 when agent already running", async () => {
    await lifecycle.start();
    expect(lifecycle.getState()).toBe("running");

    const res = await app.request("/api/agent/start", { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.state).toBe("running");
  });

  // 3. POST /api/agent/start — agent stopping
  it("POST /api/agent/start returns 409 when agent stopping", async () => {
    await lifecycle.start();
    let resolveStop!: () => void;
    lifecycle.stop(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        })
    );

    const res = await app.request("/api/agent/start", { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("stopping");

    resolveStop();
  });

  // 4. POST /api/agent/stop — agent running
  it("POST /api/agent/stop returns 200 with stopping when agent running", async () => {
    await lifecycle.start();

    const res = await app.request("/api/agent/stop", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("stopping");
  });

  // 5. POST /api/agent/stop — agent already stopped
  it("POST /api/agent/stop returns 409 when agent already stopped", async () => {
    const res = await app.request("/api/agent/stop", { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.state).toBe("stopped");
  });

  // 6. POST /api/agent/stop — agent starting
  it("POST /api/agent/stop returns 409 when agent starting", async () => {
    let resolveStart!: () => void;
    lifecycle.start(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        })
    );

    const res = await app.request("/api/agent/stop", { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("starting");

    resolveStart();
  });

  // 7. GET /api/agent/status — returns current state
  it("GET /api/agent/status returns current state", async () => {
    const res = await app.request("/api/agent/status");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("stopped");
    expect(data.uptime).toBeNull();
    expect(data.error).toBeNull();
  });

  // 8. All endpoints reject unauthenticated requests
  // (Auth is handled by WebUIServer middleware, not route-level — skipped here as
  // the routes are under /api/* which has auth middleware. Tested via integration.)

  // 9. GET /api/agent/events — SSE content-type
  // (Tested in agent-sse.test.ts)

  // 10. POST /api/agent/start — lifecycle not provided
  it("returns 503 when lifecycle not provided", async () => {
    const noLifecycleApp = createTestApp(undefined);

    const startRes = await noLifecycleApp.request("/api/agent/start", { method: "POST" });
    expect(startRes.status).toBe(503);

    const stopRes = await noLifecycleApp.request("/api/agent/stop", { method: "POST" });
    expect(stopRes.status).toBe(503);

    const statusRes = await noLifecycleApp.request("/api/agent/status");
    expect(statusRes.status).toBe(503);
  });

  // 11. GET /api/agent/status — uptime is number when running, null when stopped
  it("status uptime is number when running, null when stopped", async () => {
    // Stopped
    let res = await app.request("/api/agent/status");
    let data = await res.json();
    expect(data.uptime).toBeNull();

    // Running
    await lifecycle.start();
    res = await app.request("/api/agent/status");
    data = await res.json();
    expect(typeof data.uptime).toBe("number");
    expect(data.uptime).toBeGreaterThanOrEqual(0);
  });
});
