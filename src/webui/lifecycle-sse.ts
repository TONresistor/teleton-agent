import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import type { AgentLifecycle, StateChangeEvent } from "../agent/lifecycle.js";

/**
 * SSE stream of agent lifecycle state changes. Shared by the WebUI and API
 * servers (each keeps its own 503 guard for the missing-lifecycle case, with its
 * own error envelope, before calling this).
 */
export function createLifecycleSSE(c: Context, lifecycle: AgentLifecycle) {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    let resolveAbort!: () => void;
    const abortPromise = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });

    stream.onAbort(() => {
      aborted = true;
      resolveAbort();
    });

    // Push current state immediately on connection
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
      void stream.writeSSE({
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
    try {
      // Heartbeat loop + keep connection alive. Racing the timer with abort
      // ensures the lifecycle listener is removed immediately on disconnect.
      while (!aborted) {
        const outcome = await Promise.race([
          stream.sleep(30_000).then(() => "heartbeat" as const),
          abortPromise.then(() => "abort" as const),
        ]);
        if (outcome === "abort" || aborted) break;
        await stream.writeSSE({
          event: "ping",
          data: "",
        });
      }
    } finally {
      lifecycle.off("stateChange", onStateChange);
    }
  });
}
