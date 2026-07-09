import { describe, expect, it, vi } from "vitest";
import { registerMcpTools } from "../mcp-loader.js";

describe("MCP tool execution", () => {
  it("delegates timeout/cancellation to the MCP client without orphaning the call", async () => {
    vi.useFakeTimers();
    try {
      let registeredTools: Array<{ executor: (params: unknown) => Promise<unknown> }> = [];
      let sideEffectCompleted = false;
      const callTool = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100_000));
        sideEffectCompleted = true;
        return { isError: false, content: [{ type: "text", text: "done" }] };
      });
      const registry = {
        registerPluginTools: vi.fn((_name, tools) => {
          registeredTools = tools;
          return tools.length;
        }),
      };
      const client = {
        listTools: vi.fn(async () => ({
          tools: [
            {
              name: "mutate",
              description: "Perform one side effect",
              inputSchema: { type: "object", properties: { id: { type: "string" } } },
            },
          ],
        })),
        callTool,
      };

      await registerMcpTools(
        [{ serverName: "test", client: client as never, scope: "admin-only" }],
        registry as never
      );

      let settled = false;
      const resultPromise = registeredTools[0].executor({ id: "once" });
      void resultPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(90_000);
      expect(settled).toBe(false);
      expect(sideEffectCompleted).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(resultPromise).resolves.toEqual({ success: true, data: "done" });
      expect(sideEffectCompleted).toBe(true);
      expect(callTool).toHaveBeenCalledWith(
        { name: "mutate", arguments: { id: "once" } },
        undefined,
        expect.objectContaining({ timeout: 90_000 })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
