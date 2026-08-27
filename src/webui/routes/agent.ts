import type { AgentLifecycle } from "../../agent/lifecycle.js";
import { createAgentRoutes } from "../../api/routes/agent.js";

/** WebUI lifecycle routes with the legacy `{ error }` response envelope. */
export function createWebUIAgentRoutes(lifecycle: AgentLifecycle | null | undefined) {
  return createAgentRoutes(lifecycle, {
    errorResponse: (c, status, _title, detail) => c.json({ error: detail }, status as 503),
  });
}
