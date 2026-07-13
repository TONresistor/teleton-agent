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

describe("executeToolBatch scheduling", () => {
  it("serializes actions in model order", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const execute = vi.fn(async (call: { name: string }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${call.name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${call.name}`);
      active--;
      return { success: true };
    });
    const registry = {
      execute,
      getToolCategory: () => "action",
    };

    await executeToolBatch(
      registry as never,
      undefined,
      ["create", "update"].map((name) => ({
        type: "toolCall" as const,
        id: name,
        name,
        arguments: {},
      })),
      { bridge: {} as never, db: {} as never, chatId: "chat", senderId: 1, isGroup: false },
      "chat",
      false
    );

    expect(maxActive).toBe(1);
    expect(order).toEqual(["start:create", "end:create", "start:update", "end:update"]);
  });

  it("parallelizes only contiguous data-bearing reads", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const execute = vi.fn(async (call: { name: string }) => {
      if (call.name.startsWith("read")) {
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeReads--;
      }
      return { success: true };
    });
    const registry = {
      execute,
      getToolCategory: (name: string) => (name.startsWith("read") ? "data-bearing" : "action"),
    };

    await executeToolBatch(
      registry as never,
      undefined,
      ["read_a", "read_b", "action", "read_c"].map((name) => ({
        type: "toolCall" as const,
        id: name,
        name,
        arguments: {},
      })),
      { bridge: {} as never, db: {} as never, chatId: "chat", senderId: 1, isGroup: false },
      "chat",
      false
    );

    expect(maxActiveReads).toBe(2);
    expect(execute.mock.calls.map(([call]) => call.name)).toEqual([
      "read_a",
      "read_b",
      "action",
      "read_c",
    ]);
  });
});
