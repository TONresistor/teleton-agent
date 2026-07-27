import { describe, expect, it } from "vitest";
import { enforceProviderToolLimit } from "../tool-selector.js";

describe("provider tool limits", () => {
  const tool = (name: string) => ({ name, description: name, parameters: {} });

  it("keeps discovery and artifact paging ahead of ordinary schemas", () => {
    const limited = enforceProviderToolLimit(
      [tool("ordinary_a"), tool("tool_result_read"), tool("ordinary_b"), tool("tool_search")],
      2
    );
    expect(limited.map((entry) => entry.name)).toEqual(["tool_search", "tool_result_read"]);
  });

  it("does not copy or reorder an unlimited set", () => {
    const tools = [tool("ordinary"), tool("tool_search")];
    expect(enforceProviderToolLimit(tools, null)).toBe(tools);
  });
});
