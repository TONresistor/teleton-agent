import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createStatusRoutes } from "../routes/status.js";
import type { WebUIServerDeps } from "../types.js";

describe("WebUI agent identity", () => {
  it("returns the Telegram first name and username for the dashboard", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 42,
      firstName: "Teleton",
      username: "teleton_agent",
      isBot: true,
    });
    const deps = {
      agent: { getConfig: () => ({ agent: { model: "model", provider: "provider" } }) },
      bridge: { isAvailable: () => true, getMe },
      memory: { db: { prepare: () => ({ get: () => ({ count: 1 }) }) } },
      toolRegistry: { getAll: () => [] },
    } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/status", createStatusRoutes(deps));

    const response = await app.request("/status");
    expect(response.status).toBe(200);
    expect((await response.json()).data.agentIdentity).toEqual({
      firstName: "Teleton",
      username: "teleton_agent",
    });
    await app.request("/status");
    expect(getMe).toHaveBeenCalledOnce();
  });
});
