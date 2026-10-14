import { describe, expect, it, vi } from "vitest";
import { registerMcpTools } from "../mcp-loader.js";

const tool = (name: string) => ({
  name,
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
});
function registry() {
  return { registerPluginTools: vi.fn((_name: string, tools: unknown[]) => tools.length) };
}

describe("MCP tool discovery pagination", () => {
  it("follows all cursors, including empty intermediate pages", async () => {
    const target = registry();
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [tool("first")], nextCursor: "second-page" })
      .mockResolvedValueOnce({ tools: [], nextCursor: "third-page" })
      .mockResolvedValueOnce({ tools: [tool("last")] });
    const result = await registerMcpTools(
      [{ serverName: "paged", client: { listTools } as never, scope: "admin-only" }],
      target as never
    );
    expect(result).toEqual({ count: 2, names: ["paged"] });
    expect(listTools.mock.calls).toEqual([
      [undefined],
      [{ cursor: "second-page" }],
      [{ cursor: "third-page" }],
    ]);
    expect(target.registerPluginTools).toHaveBeenCalledWith("mcp_paged", [
      expect.objectContaining({ tool: expect.objectContaining({ name: "mcp_paged_first" }) }),
      expect.objectContaining({ tool: expect.objectContaining({ name: "mcp_paged_last" }) }),
    ]);
  });

  it("stops a cursor cycle and continues discovery on the next server", async () => {
    const target = registry();
    const cycling = vi
      .fn()
      .mockResolvedValueOnce({ tools: [tool("first")], nextCursor: "one" })
      .mockResolvedValueOnce({ tools: [tool("second")], nextCursor: "two" })
      .mockResolvedValueOnce({ tools: [tool("third")], nextCursor: "one" });
    const healthy = vi.fn().mockResolvedValue({ tools: [tool("healthy")] });
    const result = await registerMcpTools(
      [
        { serverName: "cycling", client: { listTools: cycling } as never, scope: "admin-only" },
        { serverName: "healthy", client: { listTools: healthy } as never, scope: "admin-only" },
      ],
      target as never
    );
    expect(cycling).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ count: 1, names: ["healthy"] });
    expect(target.registerPluginTools).toHaveBeenCalledTimes(1);
  });

  it("does not register an incomplete tool list when a later page fails", async () => {
    const target = registry();
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({ tools: [tool("first")], nextCursor: "next" })
      .mockRejectedValueOnce(new Error("server unavailable"));
    await expect(
      registerMcpTools(
        [{ serverName: "broken", client: { listTools } as never, scope: "admin-only" }],
        target as never
      )
    ).resolves.toEqual({ count: 0, names: [] });
    expect(target.registerPluginTools).not.toHaveBeenCalled();
  });
});
