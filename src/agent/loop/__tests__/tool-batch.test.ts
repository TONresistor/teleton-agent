import { describe, expect, it } from "vitest";
import { injectDiscoveredTools, type ToolExecResult, type ToolPlan } from "../tool-batch.js";

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
