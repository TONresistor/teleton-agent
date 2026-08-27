import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLifecycle } from "../../agent/lifecycle.js";
import { createWebUIAgentRoutes } from "../routes/agent.js";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createApp(lifecycle: AgentLifecycle | null | undefined) {
  const app = new Hono();
  app.route("/api/agent", createWebUIAgentRoutes(lifecycle));
  return app;
}

describe("WebUI agent routes", () => {
  let lifecycle: AgentLifecycle;

  beforeEach(() => {
    lifecycle = new AgentLifecycle();
    lifecycle.registerCallbacks(
      async () => {},
      async () => {}
    );
  });

  it("mounts the shared lifecycle route contract", async () => {
    const response = await createApp(lifecycle).request("/api/agent/start", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "starting" });
    await vi.waitFor(() => expect(lifecycle.getState()).toBe("running"));
  });

  it("keeps the WebUI error envelope when lifecycle is unavailable", async () => {
    const response = await createApp(null).request("/api/agent/status");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Agent lifecycle not available",
    });
  });
});
