import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse, LoadedPlugin } from "../types.js";
import {
  getPluginPriorities,
  setPluginPriority,
  resetPluginPriority,
} from "../../agent/tools/plugin-config-store.js";
import { apiError } from "../http.js";

export function createPluginsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // List all loaded plugins — computed dynamically so plugins loaded after
  // WebUI startup (via startAgent) are always reflected in the response.
  app.get("/", (c) => {
    const data = deps.marketplace
      ? deps.marketplace.modules
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      : deps.plugins;
    return c.json<APIResponse<LoadedPlugin[]>>({ success: true, data });
  });

  // ── Plugin Priorities ──────────────────────────────────────────────

  app.get("/priorities", (c) => {
    try {
      const priorities = getPluginPriorities(deps.memory.db);
      const data: Record<string, number> = {};
      for (const [name, priority] of priorities) {
        data[name] = priority;
      }
      return c.json<APIResponse<Record<string, number>>>({ success: true, data });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.post("/priorities", async (c) => {
    try {
      const body = await c.req.json<{ pluginName?: string; priority?: number }>();
      const { pluginName, priority } = body;

      if (!pluginName || typeof pluginName !== "string") {
        return c.json<APIResponse>({ success: false, error: "pluginName is required" }, 400);
      }
      if (typeof priority !== "number" || !Number.isInteger(priority)) {
        return c.json<APIResponse>({ success: false, error: "priority must be an integer" }, 400);
      }
      if (priority < -1000 || priority > 1000) {
        return c.json<APIResponse>(
          { success: false, error: "priority must be between -1000 and 1000" },
          400
        );
      }

      setPluginPriority(deps.memory.db, pluginName, priority);
      return c.json<APIResponse<{ pluginName: string; priority: number }>>({
        success: true,
        data: { pluginName, priority },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.delete("/priorities/:name", (c) => {
    try {
      const name = c.req.param("name");
      resetPluginPriority(deps.memory.db, name);
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
