import { describe, expect, it, vi } from "vitest";
import { executeScheduledTask } from "../task-executor.js";

function taskWithTool(tool: string) {
  return {
    id: "task-1",
    description: "scheduled tool",
    status: "pending" as const,
    priority: 0,
    createdAt: new Date(),
    payload: JSON.stringify({ type: "tool_call", tool, params: {} }),
  };
}

describe("executeScheduledTask", () => {
  it("marks scheduled runs as immediate execution, not planning", async () => {
    const prompt = await executeScheduledTask(
      {
        ...taskWithTool("ton_get_price"),
        payload: JSON.stringify({
          type: "agent_task",
          instructions: "Send the reminder now",
        }),
      },
      {} as never,
      {} as never,
      { getToolCategory: vi.fn(() => "data-bearing") } as never
    );

    expect(prompt).toContain("live scheduler now");
    expect(prompt).toContain("Do not create a plan");
    expect(prompt).toContain("complete the requested external actions");
  });

  it("does not auto-execute action tools", async () => {
    const registry = {
      getToolCategory: vi.fn(() => undefined),
      execute: vi.fn(),
    };

    const prompt = await executeScheduledTask(
      taskWithTool("ton_send"),
      {} as never,
      {} as never,
      registry as never
    );

    expect(registry.execute).not.toHaveBeenCalled();
    expect(prompt).toMatch(/refused.*action tool/i);
  });

  it("still auto-executes explicitly data-bearing tools", async () => {
    const registry = {
      getToolCategory: vi.fn(() => "data-bearing"),
      execute: vi.fn(async () => ({ success: true, data: { price: 5 } })),
    };

    const prompt = await executeScheduledTask(
      taskWithTool("ton_get_price"),
      {} as never,
      {} as never,
      registry as never
    );

    expect(registry.execute).toHaveBeenCalledOnce();
    expect(prompt).toContain("ton_get_price");
  });
});
