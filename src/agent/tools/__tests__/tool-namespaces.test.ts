import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import type { RegisteredTool, Tool } from "../types.js";
import { ToolRegistry } from "../registry.js";
import { registerAllTools } from "../register-all.js";
import {
  MAX_TOOLS_PER_NAMESPACE,
  buildToolNamespaceCatalog,
  formatNamespaceCatalogForPrompt,
  rankNamespacesLexically,
  resolveToolNamespace,
} from "../tool-namespaces.js";

function registeredTool(
  name: string,
  module: string,
  description = `Capability for ${name}`
): Pick<RegisteredTool, "tool" | "namespace"> {
  const tool: Tool = {
    name,
    description,
    parameters: Type.Object({}),
  };
  return {
    tool,
    namespace: resolveToolNamespace(name, module, description),
  };
}

describe("tool namespaces", () => {
  it.each([
    ["exec_run", "exec", "exec"],
    ["telegram_send_message", "telegram", "telegram.messaging"],
    ["telegram_schedule_message", "telegram", "telegram.scheduling"],
    ["telegram_search_global", "telegram", "telegram.chats"],
    ["telegram_search_posts", "telegram", "telegram.chats"],
    ["telegram_get_resale_gifts", "telegram", "telegram.gifts.market"],
    ["telegram_get_collectible_info", "telegram", "telegram.gifts.market"],
    ["telegram_buy_resale_gift", "telegram", "telegram.gifts.manage"],
    ["jetton_info", "jetton", "ton.jettons"],
    ["dex_quote", "dex", "ton.market"],
    ["uranus_create_meme", "uranus", "uranus"],
  ])("routes %s to %s", (toolName, module, expectedNamespace) => {
    expect(resolveToolNamespace(toolName, module, "description").name).toBe(expectedNamespace);
  });

  it("builds a deterministic bounded catalog and excludes core meta-tools", () => {
    const tools = [
      registeredTool("tool_search", "tool"),
      registeredTool("tool_result_read", "tool"),
      ...Array.from({ length: 25 }, (_, index) =>
        registeredTool(`uranus_action_${String(index).padStart(2, "0")}`, "uranus")
      ),
    ];

    const first = buildToolNamespaceCatalog(tools);
    const second = buildToolNamespaceCatalog([...tools].reverse());

    expect(first).toEqual(second);
    expect(first.every((entry) => entry.toolNames.length <= MAX_TOOLS_PER_NAMESPACE)).toBe(true);
    expect(first.flatMap((entry) => entry.toolNames)).toHaveLength(25);
    expect(new Set(first.flatMap((entry) => entry.toolNames)).size).toBe(25);
    expect(first.flatMap((entry) => entry.toolNames)).not.toContain("tool_search");
    expect(first.flatMap((entry) => entry.toolNames)).not.toContain("tool_result_read");
  });

  it("compacts large catalogs to root-level prompt cards", () => {
    const tools = Array.from({ length: 25 }, (_, index) =>
      registeredTool(`plugin_${index}_read`, `plugin-${index}`)
    );

    const rendered = formatNamespaceCatalogForPrompt(buildToolNamespaceCatalog(tools));

    expect(rendered.split("\n")).toHaveLength(1);
    expect(rendered).toContain("plugin (25 namespaces, 25 tools)");
  });

  it("strictly bounds prompt lines and characters across distinct plugin roots", () => {
    const tools = Array.from({ length: 30 }, (_, index) => {
      const registered = registeredTool(`tool_${index}_read`, `module${index}`);
      return {
        ...registered,
        namespace: {
          ...registered.namespace,
          description: "x".repeat(500),
        },
      };
    });

    const rendered = formatNamespaceCatalogForPrompt(buildToolNamespaceCatalog(tools));

    expect(rendered.split("\n").length).toBeLessThanOrEqual(24);
    expect(rendered.length).toBeLessThanOrEqual(4096);
    expect(rendered).toMatch(/additional namespace entries omitted/);

    const longCatalog = buildToolNamespaceCatalog(tools.slice(0, 24));
    const longRendered = formatNamespaceCatalogForPrompt(longCatalog);
    expect(longRendered.length).toBeLessThanOrEqual(4096);
    expect(longRendered).toMatch(/additional namespace entries omitted/);
  });

  it("lexically routes shell and repository work to exec", () => {
    const catalog = buildToolNamespaceCatalog([
      registeredTool("exec_run", "exec", "Run a shell command in a repository"),
      registeredTool("web_search", "web", "Search the public web"),
    ]);

    const [result] = rankNamespacesLexically("run a shell command in the repository", catalog, 1);

    expect(result.name).toBe("exec");
  });

  it("covers every context-visible built-in exactly once within the namespace bound", () => {
    const registry = new ToolRegistry("user");
    registerAllTools(registry);

    for (const isGroup of [false, true]) {
      const visibleNames = registry
        .getForContext(isGroup, null, isGroup ? "group" : "dm", true, 42)
        .map((tool) => tool.name)
        .filter((name) => name !== "tool_search" && name !== "tool_result_read")
        .sort();
      const catalog = registry.getNamespaceCatalog(isGroup, isGroup ? "group" : "dm", true, 42);
      const catalogNames = catalog.flatMap((entry) => entry.toolNames).sort();

      expect(catalogNames).toEqual(visibleNames);
      expect(new Set(catalogNames).size).toBe(catalogNames.length);
      expect(catalog.every((entry) => entry.toolNames.length <= MAX_TOOLS_PER_NAMESPACE)).toBe(
        true
      );
    }
  });
});
