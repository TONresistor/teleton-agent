import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { AgentLifecycle, type AgentState, type StateChangeEvent } from "../lifecycle.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Parse SSE text into structured events */
function parseSSE(text: string): Array<{ event?: string; data?: string; id?: string }> {
  const events: Array<{ event?: string; data?: string; id?: string }> = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const entry: { event?: string; data?: string; id?: string } = {};
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) entry.event = line.slice(6).trim();
      else if (line.startsWith("data:")) entry.data = line.slice(5).trim();
      else if (line.startsWith("id:")) entry.id = line.slice(3).trim();
    }
    if (entry.event || entry.data) events.push(entry);
  }
  return events;
}

/** Wait for lifecycle to reach a specific state */
function waitForState(
  lifecycle: AgentLifecycle,
  target: AgentState,
  timeoutMs = 2000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (lifecycle.getState() === target) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      lifecycle.off("stateChange", handler);
      reject(
        new Error(`Timeout waiting for state "${target}", current: "${lifecycle.getState()}"`)
      );
    }, timeoutMs);
    const handler = (event: StateChangeEvent) => {
      if (event.state === target) {
        clearTimeout(timer);
        lifecycle.off("stateChange", handler);
        resolve();
      }
    };
    lifecycle.on("stateChange", handler);
  });
}

/**
 * Build a full Hono app mirroring server.ts agent routes + SSE + a mock /health endpoint.
 * This is the "WebUI" portion for E2E testing.
 */
function createE2EApp(lifecycle: AgentLifecycle) {
  const app = new Hono();

  // Health check (always works, even when agent is stopped)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Mock data endpoints (simulate WebUI pages that work when agent is stopped)
  app.get("/api/status", (c) =>
    c.json({ success: true, data: { uptime: 42, model: "test", provider: "test" } })
  );
  app.get("/api/tools", (c) =>
    c.json({ success: true, data: [{ name: "test_tool", module: "core" }] })
  );
  app.get("/api/memory", (c) => c.json({ success: true, data: { messages: 10, knowledge: 5 } }));
  app.get("/api/config", (c) =>
    c.json({ success: true, data: { agent: { model: "test-model" } } })
  );

  // Agent lifecycle REST routes
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

  // SSE endpoint
  app.get("/api/agent/events", (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const now = Date.now();
      await stream.writeSSE({
        event: "status",
        id: String(now),
        data: JSON.stringify({
          state: lifecycle.getState(),
          error: lifecycle.getError() ?? null,
          timestamp: now,
        }),
        retry: 3000,
      });

      const onStateChange = (event: StateChangeEvent) => {
        if (aborted) return;
        stream.writeSSE({
          event: "status",
          id: String(event.timestamp),
          data: JSON.stringify({
            state: event.state,
            error: event.error ?? null,
            timestamp: event.timestamp,
          }),
        });
      };

      lifecycle.on("stateChange", onStateChange);

      // Short sleep for E2E tests (don't loop forever)
      await stream.sleep(100);

      lifecycle.off("stateChange", onStateChange);
    });
  });

  return app;
}

// ── E2E Tests ────────────────────────────────────────────────────────────

describe("Agent Lifecycle E2E", () => {
  let lifecycle: AgentLifecycle;
  let app: Hono;
  let startCallCount: number;
  let stopCallCount: number;
  let startFn: () => Promise<void>;
  let stopFn: () => Promise<void>;

  beforeEach(() => {
    startCallCount = 0;
    stopCallCount = 0;

    startFn = async () => {
      startCallCount++;
    };
    stopFn = async () => {
      stopCallCount++;
    };

    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(startFn, stopFn);
    app = createE2EApp(lifecycle);
  });

  afterEach(async () => {
    // Ensure lifecycle is stopped to clean up listeners
    if (lifecycle.getState() === "running") {
      await lifecycle.stop();
    }
  });

  // ── Scenario 1: Full lifecycle start → stop → restart ──

  it("full lifecycle: start → stop → restart (WebUI survives)", async () => {
    // 1. Initial state: stopped
    let res = await app.request("/api/agent/status");
    let data = await res.json();
    expect(data.state).toBe("stopped");

    // 2. Start agent via API
    res = await app.request("/api/agent/start", { method: "POST" });
    data = await res.json();
    expect(res.status).toBe(200);
    expect(data.state).toBe("starting");

    // Wait for start to complete
    await waitForState(lifecycle, "running");
    expect(lifecycle.getState()).toBe("running");
    expect(startCallCount).toBe(1);

    // 3. Verify status shows running with uptime
    res = await app.request("/api/agent/status");
    data = await res.json();
    expect(data.state).toBe("running");
    expect(typeof data.uptime).toBe("number");

    // 4. Stop agent via API
    res = await app.request("/api/agent/stop", { method: "POST" });
    data = await res.json();
    expect(res.status).toBe(200);
    expect(data.state).toBe("stopping");

    await waitForState(lifecycle, "stopped");
    expect(lifecycle.getState()).toBe("stopped");
    expect(stopCallCount).toBe(1);

    // 5. WebUI still responds (health check)
    res = await app.request("/health");
    expect(res.status).toBe(200);
    data = await res.json();
    expect(data.status).toBe("ok");

    // 6. Restart agent
    res = await app.request("/api/agent/start", { method: "POST" });
    expect(res.status).toBe(200);

    await waitForState(lifecycle, "running");
    expect(lifecycle.getState()).toBe("running");
    expect(startCallCount).toBe(2);

    // 7. Stop again for cleanup
    await lifecycle.stop();
    expect(stopCallCount).toBe(2);
  });

  // ── Scenario 2: Stop during active processing (graceful drain) ──

  it("stop waits for start to complete before stopping", async () => {
    // Simulate a slow start (like connecting to Telegram)
    let resolveStart!: () => void;
    lifecycle.registerCallbacks(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
      stopFn
    );

    // Start agent (will be pending)
    const startRes = await app.request("/api/agent/start", { method: "POST" });
    expect(startRes.status).toBe(200);
    expect(lifecycle.getState()).toBe("starting");

    // Try to stop while starting — should get 409
    const stopRes = await app.request("/api/agent/stop", { method: "POST" });
    expect(stopRes.status).toBe(409);

    // Complete the start
    resolveStart();
    await waitForState(lifecycle, "running");

    // Now stop works
    const stopRes2 = await app.request("/api/agent/stop", { method: "POST" });
    expect(stopRes2.status).toBe(200);
    await waitForState(lifecycle, "stopped");
  });

  // ── Scenario 3: Start failure ──

  it("start failure sets error and allows retry", async () => {
    let callCount = 0;
    lifecycle.registerCallbacks(async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error(`Telegram auth expired (attempt ${callCount})`);
      }
      // Third attempt succeeds
    }, stopFn);

    // First attempt: fails
    const res1 = await app.request("/api/agent/start", { method: "POST" });
    expect(res1.status).toBe(200);

    await waitForState(lifecycle, "stopped");
    expect(lifecycle.getError()).toContain("Telegram auth expired (attempt 1)");

    // Status shows error
    const statusRes = await app.request("/api/agent/status");
    const status = await statusRes.json();
    expect(status.state).toBe("stopped");
    expect(status.error).toContain("attempt 1");

    // Second attempt: fails
    const res2 = await app.request("/api/agent/start", { method: "POST" });
    expect(res2.status).toBe(200);
    await waitForState(lifecycle, "stopped");
    expect(lifecycle.getError()).toContain("attempt 2");

    // Third attempt: succeeds
    const res3 = await app.request("/api/agent/start", { method: "POST" });
    expect(res3.status).toBe(200);
    await waitForState(lifecycle, "running");
    expect(lifecycle.getError()).toBeUndefined();
    expect(lifecycle.getState()).toBe("running");

    // Cleanup
    await lifecycle.stop();
  });

  // ── Scenario 4: SSE delivers correct state on reconnection ──

  it("SSE reconnection delivers correct state", async () => {
    // Start agent
    await lifecycle.start();
    expect(lifecycle.getState()).toBe("running");

    // Connect SSE — should get "running" as initial state
    let res = await app.request("/api/agent/events");
    let text = await res.text();
    let events = parseSSE(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    let firstData = JSON.parse(events[0].data!);
    expect(firstData.state).toBe("running");

    // Stop agent
    await lifecycle.stop();
    expect(lifecycle.getState()).toBe("stopped");

    // "Reconnect" SSE — should get "stopped" as initial state
    res = await app.request("/api/agent/events");
    text = await res.text();
    events = parseSSE(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    firstData = JSON.parse(events[0].data!);
    expect(firstData.state).toBe("stopped");
  });

  // ── Scenario 5: Concurrent start/stop calls are safe ──

  it("concurrent start calls return same promise (no race)", async () => {
    // Fire two starts simultaneously
    const [res1, res2] = await Promise.all([
      app.request("/api/agent/start", { method: "POST" }),
      app.request("/api/agent/start", { method: "POST" }),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    // First gets 200 starting, second should get 200 starting or 409 running
    // (depends on timing — both are valid)
    expect([200, 409]).toContain(res1.status);
    expect([200, 409]).toContain(res2.status);

    await waitForState(lifecycle, "running");

    // Agent started exactly once
    expect(startCallCount).toBe(1);

    // Cleanup
    await lifecycle.stop();
  });

  it("concurrent stop calls after running are safe", async () => {
    await lifecycle.start();

    const [res1, res2] = await Promise.all([
      app.request("/api/agent/stop", { method: "POST" }),
      app.request("/api/agent/stop", { method: "POST" }),
    ]);

    // One should get 200, the other might get 200 or 409 (already stopping)
    expect([200, 409]).toContain(res1.status);
    expect([200, 409]).toContain(res2.status);

    await waitForState(lifecycle, "stopped");

    // Agent stopped exactly once
    expect(stopCallCount).toBe(1);
  });

  // ── Scenario 6: Config reload on restart ──

  it("startFn is called on each start (config reload opportunity)", async () => {
    const models: string[] = [];
    let currentModel = "gpt-4";

    lifecycle.registerCallbacks(async () => {
      // Simulate reading config from disk on each start
      models.push(currentModel);
    }, stopFn);

    // First start: uses gpt-4
    await lifecycle.start();
    expect(models).toEqual(["gpt-4"]);

    await lifecycle.stop();

    // "Edit config" while stopped
    currentModel = "claude-opus-4-6";

    // Second start: picks up new config
    await lifecycle.start();
    expect(models).toEqual(["gpt-4", "claude-opus-4-6"]);

    await lifecycle.stop();
  });

  // ── Scenario 7: Graceful shutdown (lifecycle + WebUI) ──

  it("full stop tears down agent then WebUI stays up", async () => {
    const teardownOrder: string[] = [];

    lifecycle.registerCallbacks(startFn, async () => {
      teardownOrder.push("agent-stopped");
    });

    await lifecycle.start();
    expect(lifecycle.getState()).toBe("running");

    // Simulate graceful shutdown: stop lifecycle first
    await lifecycle.stop();
    teardownOrder.push("webui-still-up");

    // WebUI is still responding
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    expect(teardownOrder).toEqual(["agent-stopped", "webui-still-up"]);
    expect(lifecycle.getState()).toBe("stopped");
  });

  // ── Scenario 8: WebUI pages accessible while agent stopped ──

  it("all WebUI data endpoints respond while agent is stopped", async () => {
    // Agent is stopped — verify all data endpoints still work
    expect(lifecycle.getState()).toBe("stopped");

    const endpoints = [
      "/health",
      "/api/status",
      "/api/tools",
      "/api/memory",
      "/api/config",
      "/api/agent/status",
    ];

    for (const endpoint of endpoints) {
      const res = await app.request(endpoint);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toBeDefined();
    }

    // Agent lifecycle routes also work
    const statusRes = await app.request("/api/agent/status");
    const status = await statusRes.json();
    expect(status.state).toBe("stopped");
    expect(status.uptime).toBeNull();
  });

  // ── Extra: SSE emits events during start→stop sequence ──

  it("SSE captures full start→stop state transition sequence", async () => {
    // Build a custom SSE app that collects events during a start→stop cycle
    const sseApp = new Hono();
    sseApp.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });

        const collected: StateChangeEvent[] = [];

        // Push initial
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ state: lifecycle.getState() }),
        });

        const onStateChange = (event: StateChangeEvent) => {
          if (aborted) return;
          collected.push(event);
          stream.writeSSE({
            event: "status",
            data: JSON.stringify({ state: event.state, error: event.error ?? null }),
          });
        };

        lifecycle.on("stateChange", onStateChange);

        // Trigger start → stop during stream
        await lifecycle.start();
        await lifecycle.stop();

        await stream.sleep(50);
        lifecycle.off("stateChange", onStateChange);
      });
    });

    const res = await sseApp.request("/events");
    const text = await res.text();
    const events = parseSSE(text);
    const states = events.map((e) => JSON.parse(e.data!).state);

    // Should capture: stopped (initial) → starting → running → stopping → stopped
    expect(states).toEqual(["stopped", "starting", "running", "stopping", "stopped"]);
  });
});
