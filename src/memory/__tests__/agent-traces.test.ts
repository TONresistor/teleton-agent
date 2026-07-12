import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "../schema.js";
import {
  failAgentTurnTrace,
  finishAgentTurnTrace,
  startAgentTurnTrace,
  updateAgentTurnTraceProgress,
} from "../agent-traces.js";

describe("agent turn traces", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("persists a privacy-bounded per-turn execution trace", () => {
    startAgentTurnTrace(db, {
      id: "turn-1",
      sessionId: "session-1",
      chatId: "chat-1",
      startedAt: 10,
      provider: "codex",
      model: "gpt-5.6-terra",
      selectedTools: ["tool_search"],
    });
    finishAgentTurnTrace(db, "turn-1", {
      completedAt: 20,
      status: "completed",
      tools: [{ name: "tool_search", success: true, durationMs: 5 }],
      iterations: 2,
      inputTokens: 100,
      outputTokens: 20,
      totalCost: 0.01,
      stopReason: "completed",
    });

    const row = db.prepare("SELECT * FROM agent_turn_traces WHERE id = ?").get("turn-1") as {
      status: string;
      tool_calls: number;
      tools_json: string;
      selected_tools_json: string;
      error_message: string | null;
    };
    expect(row.status).toBe("completed");
    expect(row.tool_calls).toBe(1);
    expect(JSON.parse(row.tools_json)).toEqual([
      { name: "tool_search", success: true, durationMs: 5 },
    ]);
    expect(JSON.parse(row.selected_tools_json)).toEqual(["tool_search"]);
    expect(row.error_message).toBeNull();
  });

  it("retains progress when a later phase fails", () => {
    startAgentTurnTrace(db, {
      id: "turn-2",
      sessionId: "session-1",
      chatId: "chat-1",
      startedAt: 10,
      provider: "codex",
      model: "gpt-5.6-terra",
      selectedTools: ["tool_search"],
    });
    updateAgentTurnTraceProgress(db, "turn-2", {
      tools: [{ name: "ton_get_balance", success: true, durationMs: 4 }],
      iterations: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalCost: 0,
    });
    failAgentTurnTrace(db, "turn-2", "provider unavailable");

    const row = db.prepare("SELECT * FROM agent_turn_traces WHERE id = ?").get("turn-2") as {
      status: string;
      tool_calls: number;
      tools_json: string;
      error_message: string;
    };
    expect(row.status).toBe("error");
    expect(row.tool_calls).toBe(1);
    expect(JSON.parse(row.tools_json)[0].name).toBe("ton_get_balance");
    expect(row.error_message).toBe("provider unavailable");
  });
});
