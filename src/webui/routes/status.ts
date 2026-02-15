import { Hono } from "hono";
import type { WebUIServerDeps, StatusResponse, APIResponse } from "../types.js";

export function createStatusRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  app.get("/", (c) => {
    try {
      const config = deps.agent.getConfig();

      // Count active sessions from memory DB
      const sessionCountRow = deps.memory.db
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number } | undefined;

      const data: StatusResponse = {
        uptime: process.uptime(),
        model: config.agent.model,
        provider: config.agent.provider,
        sessionCount: sessionCountRow?.count ?? 0,
        paused: false, // TODO: get from message handler
        toolCount: deps.toolRegistry.getAll().length,
      };

      const response: APIResponse<StatusResponse> = {
        success: true,
        data,
      };

      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
