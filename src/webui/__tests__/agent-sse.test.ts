import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLifecycle } from "../../agent/lifecycle.js";
import { createLifecycleSSE } from "../lifecycle-sse.js";

interface ParsedSSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

function parseEvent(block: string): ParsedSSEEvent {
  const event: ParsedSSEEvent = { data: "" };
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    else if (line.startsWith("id:")) event.id = line.slice(3).trim();
    else if (line.startsWith("retry:")) event.retry = Number(line.slice(6).trim());
  }

  event.data = data.join("\n");
  return event;
}

function createEventReader(response: Response) {
  if (!response.body) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(): Promise<ParsedSSEEvent> {
      while (!buffer.includes("\n\n")) {
        const { done, value } = await reader.read();
        if (done) throw new Error("SSE stream ended before the next event");
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      }

      const boundary = buffer.indexOf("\n\n");
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      return parseEvent(block);
    },
    cancel: () => reader.cancel(),
  };
}

function createApp(lifecycle: AgentLifecycle) {
  const app = new Hono();
  app.get("/events", (c) => createLifecycleSSE(c, lifecycle));
  return app;
}

describe("createLifecycleSSE", () => {
  let lifecycle: AgentLifecycle;

  beforeEach(() => {
    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(
      async () => {},
      async () => {}
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams the current lifecycle state immediately", async () => {
    const response = await createApp(lifecycle).request("/events");
    const events = createEventReader(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");

    const initial = await events.next();
    expect(initial.event).toBe("status");
    expect(initial.retry).toBe(3000);
    expect(JSON.parse(initial.data)).toMatchObject({
      state: "stopped",
      error: null,
    });

    await events.cancel();
  });

  it("streams the complete start and stop transition sequence", async () => {
    const response = await createApp(lifecycle).request("/events");
    const events = createEventReader(response);
    const states: string[] = [JSON.parse((await events.next()).data).state];
    await vi.waitFor(() => expect(lifecycle.listenerCount("stateChange")).toBe(1));

    const starting = lifecycle.start();
    states.push(JSON.parse((await events.next()).data).state);
    states.push(JSON.parse((await events.next()).data).state);
    await starting;

    const stopping = lifecycle.stop();
    states.push(JSON.parse((await events.next()).data).state);
    states.push(JSON.parse((await events.next()).data).state);
    await stopping;

    expect(states).toEqual(["stopped", "starting", "running", "stopping", "stopped"]);
    await events.cancel();
  });

  it("emits a heartbeat after the production interval", async () => {
    vi.useFakeTimers();
    const response = await createApp(lifecycle).request("/events");
    const events = createEventReader(response);
    await events.next();

    const pendingHeartbeat = events.next();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await pendingHeartbeat).toMatchObject({
      event: "ping",
      data: "",
    });
    await events.cancel();
  });

  it("removes its lifecycle listener immediately when the client disconnects", async () => {
    const initialListeners = lifecycle.listenerCount("stateChange");
    const response = await createApp(lifecycle).request("/events");
    const events = createEventReader(response);
    await events.next();

    await vi.waitFor(() =>
      expect(lifecycle.listenerCount("stateChange")).toBe(initialListeners + 1)
    );
    await events.cancel();
    await vi.waitFor(() => expect(lifecycle.listenerCount("stateChange")).toBe(initialListeners));
  });

  it("isolates concurrent clients and cleans up both listeners", async () => {
    const initialListeners = lifecycle.listenerCount("stateChange");
    const first = createEventReader(await createApp(lifecycle).request("/events"));
    const second = createEventReader(await createApp(lifecycle).request("/events"));

    await Promise.all([first.next(), second.next()]);
    await vi.waitFor(() =>
      expect(lifecycle.listenerCount("stateChange")).toBe(initialListeners + 2)
    );

    await first.cancel();
    await vi.waitFor(() =>
      expect(lifecycle.listenerCount("stateChange")).toBe(initialListeners + 1)
    );
    await second.cancel();
    await vi.waitFor(() => expect(lifecycle.listenerCount("stateChange")).toBe(initialListeners));
  });

  it("reports the live state again when a client reconnects", async () => {
    const first = createEventReader(await createApp(lifecycle).request("/events"));
    expect(JSON.parse((await first.next()).data).state).toBe("stopped");
    await first.cancel();

    await lifecycle.start();
    const second = createEventReader(await createApp(lifecycle).request("/events"));
    expect(JSON.parse((await second.next()).data).state).toBe("running");
    await second.cancel();
  });
});
