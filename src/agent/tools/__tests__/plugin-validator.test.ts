import { describe, expect, it } from "vitest";
import { PLUGIN_HOOK_NAMES, TOOL_CATEGORIES, TOOL_SCOPES } from "@teleton-agent/sdk";
import { validateManifest, validateToolDefs } from "../plugin-validator.js";

const execute = async () => ({ success: true });

describe("validateManifest", () => {
  it("accepts every hook declared by the public SDK contract", () => {
    const manifest = validateManifest({
      name: "contract-test",
      version: "2.0.0",
      hooks: PLUGIN_HOOK_NAMES.map((name) => ({ name, priority: 10 })),
    });

    expect(manifest.hooks?.map((hook) => hook.name)).toEqual(PLUGIN_HOOK_NAMES);
  });

  it("rejects hook names outside the public SDK contract", () => {
    expect(() =>
      validateManifest({
        name: "contract-test",
        version: "2.0.0",
        hooks: [{ name: "agent:unknown" }],
      })
    ).toThrow();
  });

  it("rejects hook priorities outside the runtime clamp", () => {
    expect(() =>
      validateManifest({
        name: "contract-test",
        version: "2.0.0",
        hooks: [{ name: "agent:start", priority: 1001 }],
      })
    ).toThrow();
  });
});

describe("validateToolDefs", () => {
  it("accepts every public scope and category", () => {
    const defs = TOOL_SCOPES.flatMap((scope) =>
      TOOL_CATEGORIES.map((category, index) => ({
        name: `tool_${scope.replaceAll("-", "_")}_${index}`,
        description: "Contract coverage",
        scope,
        category,
        execute,
      }))
    );

    expect(validateToolDefs(defs, "contract-test")).toHaveLength(defs.length);
  });

  it.each([
    { name: "UpperCase", description: "Invalid name", execute },
    { name: "valid_name", description: "Invalid scope", scope: "private", execute },
    { name: "valid_name", description: "Invalid category", category: "read", execute },
    { name: "valid_name", description: "Invalid parameters", parameters: [], execute },
  ])("rejects invalid tool contracts: $description", (definition) => {
    expect(validateToolDefs([definition], "contract-test")).toEqual([]);
  });

  it("keeps only the first duplicate tool name", () => {
    const definition = { name: "duplicate_tool", description: "A tool", execute };
    expect(validateToolDefs([definition, definition], "contract-test")).toHaveLength(1);
  });
});
