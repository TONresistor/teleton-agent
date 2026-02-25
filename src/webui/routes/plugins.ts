import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse, LoadedPlugin } from "../types.js";

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

  return app;
}
