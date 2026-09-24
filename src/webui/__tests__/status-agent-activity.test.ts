import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ensureSchema } from "../../memory/schema.js";
import { createStatusRoutes } from "../routes/status.js";
import type { WebUIServerDeps } from "../types.js";

describe("WebUI agent activity", () => {
  it("reports the last handled chat and ignores running turns from an earlier process", async () => {
    const db = new Database(":memory:");
    try {
      ensureSchema(db);
      db.prepare("INSERT INTO tg_chats (id, type, title) VALUES (?, ?, ?)").run(
        "-100123",
        "group",
        "Telegram Group"
      );
      const completedAt = Date.now() - 120_000;
      db.prepare(
        `INSERT INTO agent_turn_traces
          (id, session_id, chat_id, started_at, completed_at, status, provider, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "done",
        "session",
        "-100123",
        completedAt - 1_000,
        completedAt,
        "completed",
        "codex",
        "model"
      );
      db.prepare(
        `INSERT INTO agent_turn_traces
          (id, session_id, chat_id, started_at, status, provider, model)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "stale",
        "session",
        "-100123",
        Date.now() - process.uptime() * 1000 - 10_000,
        "running",
        "codex",
        "model"
      );

      let activeTurns = 0;
      const deps = {
        agent: {
          getConfig: () => ({ agent: { model: "model", provider: "codex" } }),
          getActiveTurnCount: () => activeTurns,
        },
        bridge: { isAvailable: () => false },
        memory: { db },
        toolRegistry: { getAll: () => [] },
      } as unknown as WebUIServerDeps;
      const app = new Hono();
      app.route("/status", createStatusRoutes(deps));

      const initial = (await (await app.request("/status")).json()).data.agentActivity;
      expect(initial).toEqual({
        processing: false,
        lastProcessedAt: completedAt,
        lastChatId: "-100123",
        lastChatName: "Telegram Group",
      });

      db.prepare(
        `INSERT INTO agent_turn_traces
          (id, session_id, chat_id, started_at, status, provider, model)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("current", "session", "-100123", Date.now(), "running", "codex", "model");
      const stillWaiting = (await (await app.request("/status")).json()).data.agentActivity;
      expect(stillWaiting.processing).toBe(false);

      activeTurns = 1;
      const active = (await (await app.request("/status")).json()).data.agentActivity;
      expect(active.processing).toBe(true);
      expect(active.lastProcessedAt).toBe(completedAt);
    } finally {
      db.close();
    }
  });
});
