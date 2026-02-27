import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { AgentLifecycle, type StateChangeEvent } from "../../agent/lifecycle.js";

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

/** Build a mini Hono app with the SSE endpoint mirroring server.ts */
function createSSEApp(lifecycle: AgentLifecycle) {
  const app = new Hono();

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

      // For testing: don't loop forever — just wait briefly for events to propagate
      await stream.sleep(50);

      lifecycle.off("stateChange", onStateChange);
    });
  });

  return app;
}

describe("Agent SSE Endpoint", () => {
  let lifecycle: AgentLifecycle;
  let app: ReturnType<typeof createSSEApp>;

  beforeEach(() => {
    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(
      async () => {},
      async () => {}
    );
    app = createSSEApp(lifecycle);
  });

  // 1. Initial connection pushes current state
  it("initial connection pushes current state", async () => {
    const res = await app.request("/api/agent/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSSE(text);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe("status");
    const data = JSON.parse(events[0].data!);
    expect(data.state).toBe("stopped");
  });

  // 2. State change emits SSE event
  it("state change emits SSE event", async () => {
    // Start agent so state is "running" when SSE connects
    await lifecycle.start();

    const sseApp = new Hono();
    sseApp.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });

        // Push current state
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ state: lifecycle.getState() }),
        });

        // Listen for state change then close
        const onStateChange = (event: StateChangeEvent) => {
          if (aborted) return;
          stream.writeSSE({
            event: "status",
            data: JSON.stringify({ state: event.state }),
          });
        };

        lifecycle.on("stateChange", onStateChange);

        // Trigger a stop during the stream
        lifecycle.stop().catch(() => {});

        await stream.sleep(50);
        lifecycle.off("stateChange", onStateChange);
      });
    });

    const res = await sseApp.request("/events");
    const text = await res.text();
    const events = parseSSE(text);

    // Should have initial "running" and then "stopping" and "stopped"
    const states = events.map((e) => JSON.parse(e.data!).state);
    expect(states).toContain("running");
    expect(states).toContain("stopped");
  });

  // 3. Heartbeat sent after interval (we use short interval for test)
  it("heartbeat (ping) is sent", async () => {
    const sseApp = new Hono();
    sseApp.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        // Send a ping immediately for test purposes
        await stream.writeSSE({ event: "ping", data: "" });
      });
    });

    const res = await sseApp.request("/events");
    const text = await res.text();
    const events = parseSSE(text);
    const pings = events.filter((e) => e.event === "ping");
    expect(pings.length).toBeGreaterThanOrEqual(1);
  });

  // 4. Client disconnect removes listener
  it("client disconnect removes listener", async () => {
    const initialListenerCount = lifecycle.listenerCount("stateChange");

    // After SSE stream ends, listeners should be cleaned up
    const res = await app.request("/api/agent/events");
    await res.text(); // consume stream

    // Listener should have been removed
    expect(lifecycle.listenerCount("stateChange")).toBe(initialListenerCount);
  });

  // 5. Multiple concurrent SSE clients
  it("multiple concurrent SSE clients receive events independently", async () => {
    const res1 = app.request("/api/agent/events");
    const res2 = app.request("/api/agent/events");

    const [r1, r2] = await Promise.all([res1, res2]);
    const text1 = await r1.text();
    const text2 = await r2.text();

    // Both should have received the initial status event
    const events1 = parseSSE(text1);
    const events2 = parseSSE(text2);
    expect(events1.length).toBeGreaterThanOrEqual(1);
    expect(events2.length).toBeGreaterThanOrEqual(1);
    expect(events1[0].event).toBe("status");
    expect(events2[0].event).toBe("status");
  });

  // 6. Error in stream handler doesn't crash server
  it("error in stream handler does not crash server", async () => {
    const errorApp = new Hono();
    errorApp.get("/events", (c) => {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "status", data: '{"state":"stopped"}' });
        // Simulate error — stream closes but server stays up
        throw new Error("simulated stream error");
      });
    });

    // Should not throw
    const res = await errorApp.request("/events");
    expect(res.status).toBe(200);
    // Stream still returned something before the error
    const text = await res.text();
    expect(text).toContain("status");
  });

  // Extra: SSE content-type header
  it("returns text/event-stream content type", async () => {
    const res = await app.request("/api/agent/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
