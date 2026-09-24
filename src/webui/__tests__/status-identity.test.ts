import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createStatusRoutes } from "../routes/status.js";
import type { WebUIServerDeps } from "../types.js";
import { GrammyBotBridge } from "../../telegram/bridges/bot.js";

describe("WebUI agent identity", () => {
  it("uses the connected bot identity even when Telegram is unavailable", async () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test" });
    const getMe = vi.spyOn(bridge.getBot().api, "getMe").mockResolvedValue({
      id: 42,
      first_name: "Teleton",
      username: "teleton_agent",
      is_bot: true,
    } as never);
    await bridge.connect();
    getMe.mockClear();
    getMe.mockRejectedValue(new Error("Telegram unavailable"));
    const deps = {
      agent: {
        getConfig: () => ({ agent: { model: "model", provider: "provider" } }),
        getActiveTurnCount: () => 0,
      },
      bridge,
      memory: { db: { prepare: () => ({ get: () => ({ count: 1 }) }) } },
      toolRegistry: { getAll: () => [] },
    } as unknown as WebUIServerDeps;
    const app = new Hono();
    app.route("/status", createStatusRoutes(deps));
    const response = await app.request("/status");
    expect(response.status).toBe(200);
    expect(getMe).not.toHaveBeenCalled();
    expect((await response.json()).data.agentIdentity).toEqual({
      firstName: "Teleton",
      username: "teleton_agent",
    });
  });

  it("returns the Telegram first name and username for the dashboard", async () => {
    const getMe = vi.fn().mockResolvedValue({
      id: 42,
      firstName: "Teleton",
      username: "teleton_agent",
      isBot: true,
    });
    const deps = {
      agent: {
        getConfig: () => ({ agent: { model: "model", provider: "provider" } }),
        getActiveTurnCount: () => 0,
      },
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
