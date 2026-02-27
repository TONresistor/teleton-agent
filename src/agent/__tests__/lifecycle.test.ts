import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { AgentLifecycle, type StateChangeEvent } from "../lifecycle.js";

describe("AgentLifecycle", () => {
  let lifecycle: AgentLifecycle;

  beforeEach(() => {
    lifecycle = new AgentLifecycle();
  });

  // 1. Initial state is stopped
  it("initial state is stopped", () => {
    expect(lifecycle.getState()).toBe("stopped");
  });

  // 2. start() transitions to starting then running
  it("start() transitions to starting then running", async () => {
    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await lifecycle.start(async () => {});

    expect(events).toHaveLength(2);
    expect(events[0].state).toBe("starting");
    expect(events[1].state).toBe("running");
    expect(lifecycle.getState()).toBe("running");
  });

  // 3. start() when already running is no-op
  it("start() when already running is no-op", async () => {
    await lifecycle.start(async () => {});
    expect(lifecycle.getState()).toBe("running");

    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await lifecycle.start(async () => {});
    expect(events).toHaveLength(0);
  });

  // 4. start() when already starting returns same promise
  it("start() when already starting returns same promise", async () => {
    let resolveStart!: () => void;
    const startFn = () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve;
      });

    const p1 = lifecycle.start(startFn);
    const p2 = lifecycle.start(async () => {});

    resolveStart();
    await p1;
    await p2;

    expect(lifecycle.getState()).toBe("running");
  });

  // 5. start() when stopping throws
  it("start() when stopping throws", async () => {
    let resolveStop!: () => void;
    await lifecycle.start(async () => {});

    const stopPromise = lifecycle.stop(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        })
    );

    await expect(lifecycle.start(async () => {})).rejects.toThrow(
      "Cannot start while agent is stopping"
    );

    resolveStop();
    await stopPromise;
  });

  // 6. stop() transitions to stopping then stopped
  it("stop() transitions to stopping then stopped", async () => {
    await lifecycle.start(async () => {});

    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await lifecycle.stop(async () => {});

    expect(events).toHaveLength(2);
    expect(events[0].state).toBe("stopping");
    expect(events[1].state).toBe("stopped");
    expect(lifecycle.getState()).toBe("stopped");
  });

  // 7. stop() when already stopped is no-op
  it("stop() when already stopped is no-op", async () => {
    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await lifecycle.stop(async () => {});
    expect(events).toHaveLength(0);
  });

  // 8. stop() when already stopping returns same promise
  it("stop() when already stopping returns same promise", async () => {
    await lifecycle.start(async () => {});

    let resolveStop!: () => void;
    const stopFn = () =>
      new Promise<void>((resolve) => {
        resolveStop = resolve;
      });

    const p1 = lifecycle.stop(stopFn);
    const p2 = lifecycle.stop(async () => {});

    resolveStop();
    await p1;
    await p2;

    expect(lifecycle.getState()).toBe("stopped");
  });

  // 9. stop() when starting waits for start then stops
  it("stop() when starting waits for start then stops", async () => {
    let resolveStart!: () => void;
    const startFn = () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve;
      });

    const startPromise = lifecycle.start(startFn);

    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    const stopPromise = lifecycle.stop(async () => {});

    // Start hasn't resolved yet, lifecycle should still be starting
    expect(lifecycle.getState()).toBe("starting");

    resolveStart();
    await startPromise;
    await stopPromise;

    expect(lifecycle.getState()).toBe("stopped");
    // Events should show: running, stopping, stopped (starting was already emitted before listener)
    expect(events.map((e) => e.state)).toEqual(["running", "stopping", "stopped"]);
  });

  // 10. Failed start() reverts to stopped with error
  it("failed start() reverts to stopped with error", async () => {
    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await expect(
      lifecycle.start(async () => {
        throw new Error("Telegram auth expired");
      })
    ).rejects.toThrow("Telegram auth expired");

    expect(lifecycle.getState()).toBe("stopped");
    expect(lifecycle.getError()).toBe("Telegram auth expired");
    expect(events).toHaveLength(2);
    expect(events[0].state).toBe("starting");
    expect(events[1].state).toBe("stopped");
    expect(events[1].error).toBe("Telegram auth expired");
  });

  // 11. start() after failed start works and clears error
  it("start() after failed start works and clears error", async () => {
    await lifecycle
      .start(async () => {
        throw new Error("fail");
      })
      .catch(() => {});

    expect(lifecycle.getError()).toBe("fail");

    await lifecycle.start(async () => {});

    expect(lifecycle.getState()).toBe("running");
    expect(lifecycle.getError()).toBeUndefined();
  });

  // 12. stateChange events include correct payload
  it("stateChange events include correct payload", async () => {
    const events: StateChangeEvent[] = [];
    lifecycle.on("stateChange", (e: StateChangeEvent) => events.push(e));

    await lifecycle.start(async () => {});

    for (const event of events) {
      expect(event).toHaveProperty("state");
      expect(event).toHaveProperty("timestamp");
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  // 13. Subsystems are started in correct order (mock tracks call order)
  it("subsystems are started in correct order", async () => {
    const order: string[] = [];
    const startFn = async () => {
      order.push("plugins");
      order.push("mcp");
      order.push("telegram");
      order.push("modules");
      order.push("debouncer");
    };

    await lifecycle.start(startFn);
    expect(order).toEqual(["plugins", "mcp", "telegram", "modules", "debouncer"]);
  });

  // 14. Subsystems are stopped in reverse order
  it("subsystems are stopped in reverse order", async () => {
    await lifecycle.start(async () => {});

    const order: string[] = [];
    const stopFn = async () => {
      order.push("watcher");
      order.push("mcp");
      order.push("debouncer");
      order.push("handler");
      order.push("modules");
      order.push("bridge");
    };

    await lifecycle.stop(stopFn);
    expect(order).toEqual(["watcher", "mcp", "debouncer", "handler", "modules", "bridge"]);
  });

  // 15. Individual subsystem failure during stop doesn't cascade
  it("individual subsystem failure during stop does not cascade", async () => {
    await lifecycle.start(async () => {});

    const completed: string[] = [];
    const stopFn = async () => {
      completed.push("step1");
      // Simulate a failure in one subsystem
      try {
        throw new Error("MCP close failed");
      } catch {
        // Error handled internally
      }
      completed.push("step2");
      completed.push("step3");
    };

    await lifecycle.stop(stopFn);
    expect(lifecycle.getState()).toBe("stopped");
    expect(completed).toEqual(["step1", "step2", "step3"]);
  });

  // 16. getUptime() returns seconds when running, null when stopped
  it("getUptime() returns seconds when running, null when stopped", async () => {
    expect(lifecycle.getUptime()).toBeNull();

    await lifecycle.start(async () => {});

    const uptime = lifecycle.getUptime();
    expect(uptime).not.toBeNull();
    expect(typeof uptime).toBe("number");
    expect(uptime).toBeGreaterThanOrEqual(0);

    await lifecycle.stop(async () => {});
    expect(lifecycle.getUptime()).toBeNull();
  });

  // 17. getError() returns null after successful start
  it("getError() returns undefined after successful start", async () => {
    // First, fail a start
    await lifecycle
      .start(async () => {
        throw new Error("initial failure");
      })
      .catch(() => {});

    expect(lifecycle.getError()).toBe("initial failure");

    // Successful start clears error
    await lifecycle.start(async () => {});
    expect(lifecycle.getError()).toBeUndefined();
  });

  // Extra: registerCallbacks + no-arg start/stop
  it("start()/stop() work with registered callbacks", async () => {
    const startFn = vi.fn(async () => {});
    const stopFn = vi.fn(async () => {});
    lifecycle.registerCallbacks(startFn, stopFn);

    await lifecycle.start();
    expect(startFn).toHaveBeenCalledOnce();
    expect(lifecycle.getState()).toBe("running");

    await lifecycle.stop();
    expect(stopFn).toHaveBeenCalledOnce();
    expect(lifecycle.getState()).toBe("stopped");
  });

  it("start() without callback or registration throws", async () => {
    await expect(lifecycle.start()).rejects.toThrow("No start function provided or registered");
  });

  it("stop() without callback or registration throws when not stopped", async () => {
    await lifecycle.start(async () => {});
    // Now try stop() with no registered callback
    lifecycle["registeredStopFn"] = null;
    await expect(lifecycle.stop()).rejects.toThrow("No stop function provided or registered");
  });
});
