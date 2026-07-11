import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse, MarketplacePlugin } from "../types.js";
import { MarketplaceService, ConflictError } from "../services/marketplace.js";
import { writePluginSecret, deletePluginSecret, listPluginSecretKeys } from "../../sdk/secrets.js";
import { apiError } from "../http.js";

const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
const VALID_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function createMarketplaceRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  let service: MarketplaceService | null = null;

  const getService = () => {
    if (!deps.marketplace) return null;
    service ??= new MarketplaceService({ ...deps.marketplace, toolRegistry: deps.toolRegistry });
    return service;
  };

  // GET / — list all marketplace plugins
  app.get("/", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const refresh = c.req.query("refresh") === "true";
      const plugins = await svc.listPlugins(refresh);
      return c.json<APIResponse<MarketplacePlugin[]>>({ success: true, data: plugins });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // POST /install — install a plugin
  app.post("/install", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.installPlugin(body.id);
      // Update plugins list for the existing /api/plugins route
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (error: unknown) {
      const status = error instanceof ConflictError ? 409 : 500;
      return apiError(c, error, status);
    }
  });

  // POST /uninstall — uninstall a plugin
  app.post("/uninstall", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.uninstallPlugin(body.id);
      // Update plugins list
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (error: unknown) {
      const status = error instanceof ConflictError ? 409 : 500;
      return apiError(c, error, status);
    }
  });

  // POST /update — update a plugin
  app.post("/update", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    try {
      const body = await c.req.json<{ id: string }>();
      if (!body.id) {
        return c.json<APIResponse>({ success: false, error: "Missing plugin id" }, 400);
      }

      const result = await svc.updatePlugin(body.id);
      // Update plugins list
      deps.plugins.length = 0;
      deps.plugins.push(
        ...(deps.marketplace?.modules ?? [])
          .filter((m) => deps.toolRegistry.isPluginModule(m.name))
          .map((m) => ({ name: m.name, version: m.version ?? "0.0.0" }))
      );
      return c.json<APIResponse<typeof result>>({ success: true, data: result });
    } catch (error: unknown) {
      const status = error instanceof ConflictError ? 409 : 500;
      return apiError(c, error, status);
    }
  });

  // GET /secrets/:pluginId — list declared + configured secrets
  app.get("/secrets/:pluginId", async (c) => {
    const svc = getService();
    if (!svc) {
      return c.json<APIResponse>({ success: false, error: "Marketplace not configured" }, 501);
    }

    const pluginId = c.req.param("pluginId");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }

    try {
      const plugins = await svc.listPlugins();
      const plugin = plugins.find((p) => p.id === pluginId);
      const declared = plugin?.secrets ?? {};
      const configured = listPluginSecretKeys(pluginId);
      return c.json<
        APIResponse<{
          declared: Record<string, { required: boolean; description: string; env?: string }>;
          configured: string[];
        }>
      >({ success: true, data: { declared, configured } });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // PUT /secrets/:pluginId/:key — set a secret value
  app.put("/secrets/:pluginId/:key", async (c) => {
    const pluginId = c.req.param("pluginId");
    const key = c.req.param("key");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }
    if (!key || !VALID_KEY.test(key)) {
      return c.json<APIResponse>(
        { success: false, error: "Invalid key name — use letters, digits, underscores" },
        400
      );
    }

    try {
      const body = await c.req.json<{ value: string }>();
      if (typeof body.value !== "string" || !body.value) {
        return c.json<APIResponse>({ success: false, error: "Missing or invalid value" }, 400);
      }
      writePluginSecret(pluginId, key, body.value);
      return c.json<APIResponse<{ key: string; set: boolean }>>({
        success: true,
        data: { key, set: true },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // DELETE /secrets/:pluginId/:key — unset a secret
  app.delete("/secrets/:pluginId/:key", async (c) => {
    const pluginId = c.req.param("pluginId");
    const key = c.req.param("key");
    if (!VALID_ID.test(pluginId)) {
      return c.json<APIResponse>({ success: false, error: "Invalid plugin ID" }, 400);
    }
    if (!key || !VALID_KEY.test(key)) {
      return c.json<APIResponse>(
        { success: false, error: "Invalid key name — use letters, digits, underscores" },
        400
      );
    }

    try {
      deletePluginSecret(pluginId, key);
      return c.json<APIResponse<{ key: string; set: boolean }>>({
        success: true,
        data: { key, set: false },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
