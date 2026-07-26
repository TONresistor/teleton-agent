import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../../../memory/schema.js";

vi.mock("../../../session/transcript.js", () => ({ appendToTranscript: vi.fn() }));

import { recordToolResults, type ToolExecResult, type ToolPlan } from "../tool-batch.js";

describe("large tool result artifacts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("stores the full result and returns a paged artifact reference", async () => {
    const plans: ToolPlan[] = [
      {
        block: { type: "toolCall", id: "call-1", name: "large_tool", arguments: {} },
        blocked: false,
        blockReason: "",
        params: {},
      },
    ];
    const results: ToolExecResult[] = [
      {
        result: { success: true, data: { content: "x".repeat(60_000) } },
        durationMs: 5,
        attempted: true,
      },
    ];

    const messages = await recordToolResults(undefined, plans, results, {
      totalToolCalls: [],
      iterationToolNames: [],
      sessionId: "session-1",
      chatId: "chat-1",
      effectiveIsGroup: false,
      db,
    });

    const text = messages[0].role === "toolResult" ? messages[0].content[0].text : "";
    const payload = JSON.parse(text) as { data: { _artifact: { id: string } } };
    expect(payload.data._artifact.id).toHaveLength(36);
    const stored = db
      .prepare("SELECT content FROM tool_result_artifacts WHERE id = ?")
      .get(payload.data._artifact.id) as { content: string };
    expect(stored.content.length).toBeGreaterThan(60_000);
  });
});
