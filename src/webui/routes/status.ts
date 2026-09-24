import { Hono } from "hono";
import type {
  WebUIServerDeps,
  StatusResponse,
  TokenActivityBucket,
  APIResponse,
} from "../types.js";
import { apiError } from "../http.js";
import { getTokenUsage } from "../../agent/token-usage.js";

export function createStatusRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  let identityBridge = deps.bridge;
  let agentIdentity: StatusResponse["agentIdentity"];

  app.get("/token-activity", (c) => {
    const offsetMinutes = Number(c.req.query("offsetMinutes") ?? 0);
    if (!Number.isInteger(offsetMinutes) || offsetMinutes < -840 || offsetMinutes > 840) {
      return c.json({ success: false, error: "Invalid timezone offset" }, 400);
    }
    const period = c.req.query("period") ?? "month";
    if (period !== "day" && period !== "week" && period !== "month") {
      return c.json({ success: false, error: "Invalid activity period" }, 400);
    }

    try {
      const dayMs = 86_400_000;
      const hourMs = 3_600_000;
      const offsetMs = offsetMinutes * 60_000;
      const today = Math.floor((Date.now() - offsetMs) / dayMs);
      const daysSinceMonday = (new Date(today * dayMs).getUTCDay() + 6) % 7;
      const firstLocal =
        (today - (period === "month" ? 29 : period === "week" ? daysSinceMonday : 0)) * dayMs;
      const bucketMs = period === "month" ? dayMs : hourMs;
      const count = period === "month" ? 30 : period === "week" ? 168 : 24;
      const rows = deps.memory.db
        .prepare(
          `SELECT started_at, input_tokens, output_tokens
           FROM agent_turn_traces
           WHERE started_at >= ? AND started_at < ? AND status != 'running'
           ORDER BY started_at`
        )
        .all(firstLocal + offsetMs, (today + 1) * dayMs + offsetMs) as Array<{
        started_at: number;
        input_tokens: number;
        output_tokens: number;
      }>;
      const buckets: TokenActivityBucket[] = Array.from({ length: count }, (_, index) => {
        const localTime = firstLocal + index * bucketMs;
        return {
          label: new Date(localTime)
            .toISOString()
            .slice(0, period === "month" ? 10 : 16)
            .replace("T", " "),
          tokens: 0,
        };
      });
      for (const row of rows) {
        const index = Math.floor((row.started_at - offsetMs - firstLocal) / bucketMs);
        if (index >= 0 && index < buckets.length) {
          buckets[index].tokens += row.input_tokens + row.output_tokens;
        }
      }
      return c.json({ success: true, data: buckets } satisfies APIResponse<TokenActivityBucket[]>);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  app.get("/", async (c) => {
    try {
      const config = deps.agent.getConfig();
      if (deps.bridge !== identityBridge) {
        identityBridge = deps.bridge;
        agentIdentity = undefined;
      }
      if (!agentIdentity && identityBridge.isAvailable()) {
        try {
          const me = await identityBridge.getMe();
          if (me) agentIdentity = { firstName: me.firstName, username: me.username };
        } catch {
          // Identity is optional; keep the rest of the dashboard available.
        }
      }

      // Count active sessions from memory DB
      const sessionCountRow = deps.memory.db
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number } | undefined;
      const lastTurn = deps.memory.db
        .prepare(
          `SELECT t.chat_id, COALESCE(t.completed_at, t.started_at) as handled_at,
            COALESCE(c.title,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
              c.username, u.username) as chat_name
           FROM agent_turn_traces t
           LEFT JOIN tg_chats c ON c.id = t.chat_id
           LEFT JOIN tg_users u ON c.type = 'dm' AND u.id = c.id
           WHERE t.status != 'running'
           ORDER BY t.started_at DESC LIMIT 1`
        )
        .get() as { chat_id: string; handled_at: number; chat_name: string | null } | undefined;

      const data: StatusResponse = {
        uptime: process.uptime(),
        model: config.agent.model,
        provider: config.agent.provider,
        agentIdentity,
        agentActivity: {
          processing: deps.agent.getActiveTurnCount() > 0,
          lastProcessedAt: lastTurn?.handled_at,
          lastChatId: lastTurn?.chat_id,
          lastChatName: lastTurn?.chat_name ?? undefined,
        },
        sessionCount: sessionCountRow?.count ?? 0,
        toolCount: deps.toolRegistry.getAll().length,
        tokenUsage: getTokenUsage(),
        platform: process.platform,
      };

      const response: APIResponse<StatusResponse> = {
        success: true,
        data,
      };

      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
