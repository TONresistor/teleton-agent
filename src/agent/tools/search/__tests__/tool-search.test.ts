import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";
import { ToolRegistry } from "../../registry.js";
import type { ToolIndex } from "../../tool-index.js";
import { createToolSearchExecutor } from "../tool-search.js";

function context(senderId = 42, isAdmin = true, isGuest = false): ToolContext {
  return {
    bridge: { getMode: () => "user" } as never,
    db: {} as never,
    chatId: "dm",
    senderId,
    isGroup: false,
    isGuest,
    config: { telegram: { admin_ids: isAdmin ? [senderId] : [] } } as never,
  };
}

function registerFixtureTools(registry: ToolRegistry): void {
  const parameters = Type.Object({ command: Type.Optional(Type.String()) });
  registry.register(
    { name: "exec_run", description: "Run a shell command", parameters },
    vi.fn(async () => ({ success: true })),
    "admin-only"
  );
  registry.register(
    { name: "exec_status", description: "Inspect command status", parameters },
    vi.fn(async () => ({ success: true })),
    "admin-only"
  );
  registry.register(
    { name: "web_search", description: "Search the public web", parameters },
    vi.fn(async () => ({ success: true }))
  );
}

describe("tool_search hierarchical routing", () => {
  it("routes through namespaces before searching a bounded tool set", async () => {
    const registry = new ToolRegistry();
    registerFixtureTools(registry);
    const searchNamespaces = vi.fn(async (_query, _embedding, catalog) => [
      { ...catalog.find((entry: { name: string }) => entry.name === "exec"), score: 0.9 },
    ]);
    const searchWithin = vi.fn(
      async (_query: string, _embedding: number[], _allowedNames: ReadonlySet<string>) => [
        { name: "exec_run", description: "Run a shell command", score: 1 },
      ]
    );
    const globalSearch = vi.fn(async () => [
      { name: "exec_run", description: "Run a shell command", score: 1 },
    ]);
    registry.setToolIndex({
      isIndexed: true,
      searchNamespaces,
      searchWithin,
      search: globalSearch,
    } as unknown as ToolIndex);

    const result = await createToolSearchExecutor(registry)({ query: "run a command" }, context());

    expect(searchNamespaces).toHaveBeenCalledOnce();
    const allowedNames = searchWithin.mock.calls[0][2] as Set<string>;
    expect([...allowedNames]).toEqual(["exec_run", "exec_status"]);
    expect(globalSearch).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      tools_found: 1,
      namespaces_searched: [{ name: "exec", score: 0.9 }],
    });
  });

  it("does not mix global action tools into a successful namespace result", async () => {
    const registry = new ToolRegistry();
    registerFixtureTools(registry);
    registry.setToolIndex({
      isIndexed: true,
      searchNamespaces: vi.fn(async (_query, _embedding, catalog) => [
        { ...catalog.find((entry: { name: string }) => entry.name === "web"), score: 0.8 },
      ]),
      searchWithin: vi.fn(async () => [
        { name: "web_search", description: "Search the public web", score: 0.7 },
      ]),
      search: vi.fn(async () => [
        { name: "web_search", description: "Search the public web", score: 0.98 },
        { name: "exec_run", description: "Run a shell command", score: 0.95 },
      ]),
    } as unknown as ToolIndex);

    const result = await createToolSearchExecutor(registry)(
      { query: "run a shell command" },
      context()
    );
    const tools = (result.data as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).toEqual(["web_search"]);
  });

  it("accepts a case-insensitive explicit namespace without an index", async () => {
    const registry = new ToolRegistry();
    registerFixtureTools(registry);

    const result = await createToolSearchExecutor(registry)(
      {
        query: "capability with no lexical overlap",
        namespace: " EXEC ",
      },
      context()
    );

    expect(result.data).toMatchObject({
      tools_found: 2,
      namespaces_searched: [{ name: "exec", score: 1 }],
    });
  });

  it("falls back to lexical namespace routing when the semantic router fails", async () => {
    const registry = new ToolRegistry();
    registerFixtureTools(registry);
    const searchWithin = vi.fn(
      async (_query: string, _embedding: number[], allowedNames: ReadonlySet<string>) =>
        [...allowedNames]
          .filter((name) => name === "exec_run")
          .map((name) => ({ name, description: "Run a shell command", score: 1 }))
    );
    registry.setToolIndex({
      isIndexed: true,
      searchNamespaces: vi.fn(async () => {
        throw new Error("semantic router unavailable");
      }),
      searchWithin,
      search: vi.fn(async () => []),
    } as unknown as ToolIndex);

    const result = await createToolSearchExecutor(registry)(
      { query: "run a shell command" },
      context()
    );

    expect(searchWithin).toHaveBeenCalledOnce();
    expect(result.data).toMatchObject({
      tools_found: 1,
      namespaces_searched: [{ name: "exec" }],
    });
  });

  it("never advertises or returns inaccessible namespace tools", async () => {
    const registry = new ToolRegistry();
    registerFixtureTools(registry);

    const result = await createToolSearchExecutor(registry)(
      {
        query: "run a shell command",
        namespace: "exec",
      },
      context(7, false)
    );

    expect(
      registry.getNamespaceCatalog(false, "dm", false, 7).map((entry) => entry.name)
    ).not.toContain("exec");
    expect(result.data).toMatchObject({ tools_found: 0 });
  });

  it("never discovers Telegram send tools for guests", async () => {
    const registry = new ToolRegistry();
    registry.register(
      {
        name: "telegram_send_message",
        description: "Send a Telegram message",
        parameters: Type.Object({ text: Type.String() }),
      },
      vi.fn(async () => ({ success: true }))
    );

    const result = await createToolSearchExecutor(registry)(
      { query: "send a message", namespace: "telegram.messaging" },
      context(7, false, true)
    );

    expect(result.data).toMatchObject({ tools_found: 0 });
  });
});
