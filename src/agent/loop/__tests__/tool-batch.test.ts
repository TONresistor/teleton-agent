import { describe, expect, it, vi } from "vitest";
import {
  executeToolBatch,
  injectDiscoveredTools,
  type ToolExecResult,
  type ToolPlan,
} from "../tool-batch.js";

function discoveryPlan(): ToolPlan {
  return {
    block: {
      type: "toolCall",
      id: "search",
      name: "tool_search",
      arguments: { query: "tools" },
    },
    blocked: false,
    blockReason: "",
    params: { query: "tools" },
  };
}

describe("injectDiscoveredTools", () => {
  it("respects provider limits and excluded tool names", () => {
    const tools = [{ name: "tool_search", description: "Search", parameters: {} }];
    const result: ToolExecResult = {
      durationMs: 1,
      result: {
        success: true,
        data: {
          tools: [
            { name: "telegram_send_message", description: "Send", parameters: {} },
            { name: "exec_run", description: "Run", parameters: {} },
            { name: "web_search", description: "Search", parameters: {} },
          ],
        },
      },
    };

    const injected = injectDiscoveredTools(
      [discoveryPlan()],
      [result],
      tools,
      2,
      new Set(["telegram_send_message"])
    );

    expect(injected).toBe(1);
    expect(tools.map((tool) => tool.name)).toEqual(["tool_search", "exec_run"]);
    expect(result.result.data).toMatchObject({
      tools_found: 1,
      tools: [{ name: "exec_run" }],
      hint: "These tools are now available. Call them directly.",
    });
  });
});

describe("executeToolBatch budgets", () => {
  it("does not start tool calls beyond the remaining per-turn budget", async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const calls = ["first_tool", "second_tool"].map((name, index) => ({
      type: "toolCall" as const,
      id: `call-${index}`,
      name,
      arguments: {},
    }));

    const { toolPlans, execResults } = await executeToolBatch(
      { execute } as never,
      undefined,
      calls,
      {
        bridge: {} as never,
        db: {} as never,
        chatId: "chat-1",
        senderId: 1,
        isGroup: false,
      },
      "chat-1",
      false,
      1
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execResults.map((result) => result.attempted)).toEqual([true, false]);
    expect(toolPlans[1]).toMatchObject({
      blocked: true,
      blockReason: "Per-turn tool-call budget exhausted",
    });
  });
});
