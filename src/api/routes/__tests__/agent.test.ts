import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLifecycle } from "../../../agent/lifecycle.js";
import { createAgentRoutes, type AgentRouteErrorMapper } from "../agent.js";

vi.mock("../../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createApp(
  lifecycle: AgentLifecycle | null | undefined,
  errorResponse?: AgentRouteErrorMapper
) {
  const app = new Hono();
  app.route("/agent", createAgentRoutes(lifecycle, { errorResponse }));
  return app;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createAgentRoutes", () => {
  let lifecycle: AgentLifecycle;
  let startCallback: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let stopCallback: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    startCallback = vi.fn(async () => {});
    stopCallback = vi.fn(async () => {});
    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(startCallback, stopCallback);
  });

  it("starts a stopped lifecycle", async () => {
    const response = await createApp(lifecycle).request("/agent/start", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "starting" });
    await vi.waitFor(() => expect(lifecycle.getState()).toBe("running"));
    expect(startCallback).toHaveBeenCalledOnce();
  });

  it("reports an already-running lifecycle without starting twice", async () => {
    await lifecycle.start();

    const response = await createApp(lifecycle).request("/agent/start", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ state: "running" });
    expect(startCallback).toHaveBeenCalledOnce();
  });

  it("rejects start while the lifecycle is stopping", async () => {
    await lifecycle.start();
    const gate = deferred();
    const stopping = lifecycle.stop(() => gate.promise);

    const response = await createApp(lifecycle).request("/agent/start", { method: "POST" });

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({
      status: 409,
      detail: "Agent is currently stopping, please wait",
    });

    gate.resolve();
    await stopping;
  });

  it("stops a running lifecycle", async () => {
    await lifecycle.start();

    const response = await createApp(lifecycle).request("/agent/stop", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "stopping" });
    await vi.waitFor(() => expect(lifecycle.getState()).toBe("stopped"));
    expect(stopCallback).toHaveBeenCalledOnce();
  });

  it("reports an already-stopped lifecycle without stopping twice", async () => {
    const response = await createApp(lifecycle).request("/agent/stop", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ state: "stopped" });
    expect(stopCallback).not.toHaveBeenCalled();
  });

  it("rejects stop while the lifecycle is starting", async () => {
    const gate = deferred();
    const starting = lifecycle.start(() => gate.promise);

    const response = await createApp(lifecycle).request("/agent/stop", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 409,
      detail: "Agent is currently starting, please wait",
    });

    gate.resolve();
    await starting;
  });

  it("returns lifecycle state, uptime, and error", async () => {
    const app = createApp(lifecycle);

    let response = await app.request("/agent/status");
    expect(await response.json()).toEqual({
      state: "stopped",
      uptime: null,
      error: null,
    });

    await lifecycle.start();
    response = await app.request("/agent/status");
    expect(await response.json()).toMatchObject({
      state: "running",
      error: null,
    });
  });

  it("restarts a running lifecycle", async () => {
    await lifecycle.start();

    const response = await createApp(lifecycle).request("/agent/restart", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "restarting" });
    await vi.waitFor(() => {
      expect(lifecycle.getState()).toBe("running");
      expect(startCallback).toHaveBeenCalledTimes(2);
      expect(stopCallback).toHaveBeenCalledOnce();
    });
  });

  it.each(["starting", "stopping"] as const)("rejects restart while %s", async (state) => {
    const gate = deferred();
    let transition: Promise<void>;
    if (state === "starting") {
      transition = lifecycle.start(() => gate.promise);
    } else {
      await lifecycle.start();
      transition = lifecycle.stop(() => gate.promise);
    }

    const response = await createApp(lifecycle).request("/agent/restart", { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 409,
      detail: `Agent is currently ${state}, please wait`,
    });

    gate.resolve();
    await transition;
  });

  it("returns 503 for every route when lifecycle is unavailable", async () => {
    const app = createApp(null);

    for (const [path, method] of [
      ["/agent/start", "POST"],
      ["/agent/stop", "POST"],
      ["/agent/status", "GET"],
      ["/agent/restart", "POST"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(await response.json()).toMatchObject({
        status: 503,
        detail: "Agent lifecycle not available",
      });
    }
  });

  it("uses the injected server-specific error mapper", async () => {
    const errorResponse: AgentRouteErrorMapper = (c, status, title, detail) =>
      c.json({ error: detail, title }, status as 503);

    const response = await createApp(null, errorResponse).request("/agent/status");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Agent lifecycle not available",
      title: "Service Unavailable",
    });
  });

  it("contains asynchronous start failures and exposes them through status", async () => {
    lifecycle.registerCallbacks(async () => {
      throw new Error("Telegram auth expired");
    }, stopCallback);
    const app = createApp(lifecycle);

    const response = await app.request("/agent/start", { method: "POST" });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(lifecycle.getState()).toBe("stopped"));

    const status = await app.request("/agent/status");
    expect(await status.json()).toMatchObject({
      state: "stopped",
      error: "Telegram auth expired",
    });
  });
});
