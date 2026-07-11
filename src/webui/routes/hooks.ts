import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  getBlocklistConfig,
  setBlocklistConfig,
  getTriggersConfig,
  setTriggersConfig,
  type BlocklistConfig,
  type TriggerEntry,
} from "../../agent/hooks/user-hook-store.js";
import { apiError } from "../http.js";

export function createHooksRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  // ── Blocklist ────────────────────────────────────────────────────

  app.get("/blocklist", (c) => {
    try {
      const data = getBlocklistConfig(deps.memory.db);
      return c.json<APIResponse<BlocklistConfig>>({ success: true, data });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.put("/blocklist", async (c) => {
    try {
      const body = await c.req.json<{
        enabled?: boolean;
        keywords?: string[];
        message?: string;
      }>();

      if (typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "enabled must be a boolean" }, 400);
      }
      if (!Array.isArray(body.keywords)) {
        return c.json<APIResponse>({ success: false, error: "keywords must be an array" }, 400);
      }
      if (body.keywords.length > 200) {
        return c.json<APIResponse>({ success: false, error: "Maximum 200 keywords" }, 400);
      }

      const keywords = body.keywords
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k.length >= 2);

      const message = typeof body.message === "string" ? body.message.slice(0, 500) : "";

      const config: BlocklistConfig = {
        enabled: body.enabled,
        keywords,
        message,
      };
      setBlocklistConfig(deps.memory.db, config);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<BlocklistConfig>>({ success: true, data: config });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  // ── Context Triggers ─────────────────────────────────────────────

  app.get("/triggers", (c) => {
    try {
      const data = getTriggersConfig(deps.memory.db);
      return c.json<APIResponse<TriggerEntry[]>>({ success: true, data });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.post("/triggers", async (c) => {
    try {
      const body = await c.req.json<{
        keyword?: string;
        context?: string;
        enabled?: boolean;
      }>();

      const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
      const context = typeof body.context === "string" ? body.context.trim() : "";

      if (keyword.length < 2 || keyword.length > 100) {
        return c.json<APIResponse>(
          { success: false, error: "keyword must be 2-100 characters" },
          400
        );
      }
      if (context.length < 1 || context.length > 2000) {
        return c.json<APIResponse>(
          { success: false, error: "context must be 1-2000 characters" },
          400
        );
      }

      const triggers = getTriggersConfig(deps.memory.db);
      if (triggers.length >= 50) {
        return c.json<APIResponse>({ success: false, error: "Maximum 50 triggers" }, 400);
      }

      const entry: TriggerEntry = {
        id: randomUUID(),
        keyword,
        context,
        enabled: body.enabled !== false,
      };
      triggers.push(entry);
      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<TriggerEntry>>({ success: true, data: entry });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.put("/triggers/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{
        keyword?: string;
        context?: string;
        enabled?: boolean;
      }>();

      const triggers = getTriggersConfig(deps.memory.db);
      const idx = triggers.findIndex((t) => t.id === id);
      if (idx === -1) {
        return c.json<APIResponse>({ success: false, error: "Trigger not found" }, 404);
      }

      if (typeof body.keyword === "string") {
        const kw = body.keyword.trim();
        if (kw.length < 2 || kw.length > 100) {
          return c.json<APIResponse>(
            { success: false, error: "keyword must be 2-100 characters" },
            400
          );
        }
        triggers[idx].keyword = kw;
      }
      if (typeof body.context === "string") {
        const ctx = body.context.trim();
        if (ctx.length < 1 || ctx.length > 2000) {
          return c.json<APIResponse>(
            { success: false, error: "context must be 1-2000 characters" },
            400
          );
        }
        triggers[idx].context = ctx;
      }
      if (typeof body.enabled === "boolean") {
        triggers[idx].enabled = body.enabled;
      }

      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<TriggerEntry>>({ success: true, data: triggers[idx] });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.delete("/triggers/:id", (c) => {
    try {
      const id = c.req.param("id");
      const triggers = getTriggersConfig(deps.memory.db);
      const filtered = triggers.filter((t) => t.id !== id);
      setTriggersConfig(deps.memory.db, filtered);
      deps.userHookEvaluator?.reload();
      return c.json<APIResponse<null>>({ success: true, data: null });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  app.patch("/triggers/:id/toggle", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ enabled?: boolean }>();

      if (typeof body.enabled !== "boolean") {
        return c.json<APIResponse>({ success: false, error: "enabled must be a boolean" }, 400);
      }

      const triggers = getTriggersConfig(deps.memory.db);
      const trigger = triggers.find((t) => t.id === id);
      if (!trigger) {
        return c.json<APIResponse>({ success: false, error: "Trigger not found" }, 404);
      }

      trigger.enabled = body.enabled;
      setTriggersConfig(deps.memory.db, triggers);
      deps.userHookEvaluator?.reload();

      return c.json<APIResponse<{ id: string; enabled: boolean }>>({
        success: true,
        data: { id, enabled: body.enabled },
      });
    } catch (error: unknown) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
