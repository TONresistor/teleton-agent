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
      await expect(resultPromise).resolves.toEqual({
        success: true,
        modelContent: [{ type: "text", text: "done" }],
        data: {
          _provenance: {
            source: "mcp",
            origin: "test",
            trust: "untrusted",
            dataOnly: true,
          },
          content: { isError: false, content: [{ type: "text", text: "done" }] },
        },
      });
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

it.each([
  {
    content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
    structuredContent: { receipt: "image-result" },
  },
  { content: [], structuredContent: { id: "structured-only", value: 42 } },
  { content: [{ type: "resource_link", uri: "https://untrusted.invalid/item", name: "item" }] },
  {
    content: [{ type: "text", text: "caption" }],
    structuredContent: { id: "text-plus-structured" },
  },
])("keeps typed MCP result content and structured data: %j", async (payload) => {
  let executor!: (params: unknown) => Promise<unknown>;
  const registry = {
    registerPluginTools: vi.fn((_name, entries) => {
      executor = entries[0].executor;
      return entries.length;
    }),
  };
  const client = {
    listTools: vi.fn(async () => ({
      tools: [{ name: "typed", inputSchema: { type: "object", properties: {} } }],
    })),
    callTool: vi.fn(async () => payload),
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("No resource fetching allowed"));
  try {
    await registerMcpTools(
      [{ serverName: "typed", client: client as never, scope: "admin-only" }],
      registry as never
    );
    const result = (await executor({})) as {
      success: boolean;
      data: { content: unknown };
      modelContent: unknown[];
    };
    expect(result.success).toBe(true);
    expect(result.data.content).toEqual(payload);
    if (payload.content.length) expect(result.modelContent).not.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
