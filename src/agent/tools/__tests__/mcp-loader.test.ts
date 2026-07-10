import { describe, expect, it, vi } from "vitest";
import { registerMcpTools } from "../mcp-loader.js";

describe("MCP tool execution", () => {
  it("uses a bounded timeout for untrusted MCP actions", async () => {
    vi.useFakeTimers();
    try {
      let registeredTools: Array<{
        tool: { category?: string };
        executor: (params: unknown) => Promise<unknown>;
      }> = [];
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
              annotations: { readOnlyHint: true },
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

      expect(registeredTools[0].tool.category).toBe("action");

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
        expect.objectContaining({ timeout: 125_000 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a stalled MCP action with a non-retryable unknown outcome", async () => {
    vi.useFakeTimers();
    try {
      let registeredTools: Array<{
        executor: (params: unknown) => Promise<unknown>;
      }> = [];
      const registry = {
        registerPluginTools: vi.fn((_name, tools) => {
          registeredTools = tools;
          return tools.length;
        }),
      };
      const client = {
        listTools: vi.fn(async () => ({
          tools: [{ name: "hang", inputSchema: { type: "object", properties: {} } }],
        })),
        callTool: vi.fn(
          async () =>
            await new Promise((resolve) =>
              setTimeout(() => resolve({ isError: false, content: [] }), 300_000)
            )
        ),
      };

      await registerMcpTools(
        [{ serverName: "test", client: client as never, scope: "admin-only" }],
        registry as never
      );

      const resultPromise = registeredTools[0].executor({});
      await vi.advanceTimersByTimeAsync(120_000);

      await expect(resultPromise).resolves.toMatchObject({
        success: false,
        data: { outcome: "unknown", retryable: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
