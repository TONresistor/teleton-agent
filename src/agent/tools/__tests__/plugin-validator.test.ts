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

  it("accepts uppercase secret environment variable overrides", () => {
    const manifest = validateManifest({
      name: "contract-test",
      version: "2.0.0",
      secrets: {
        api_key: {
          required: true,
          description: "External API key",
          env: "TELETON_PLUGIN_CONTRACT_TEST_SHARED_API_KEY_2",
        },
      },
    });

    expect(manifest.secrets?.api_key?.env).toBe("TELETON_PLUGIN_CONTRACT_TEST_SHARED_API_KEY_2");
  });

  it.each(["lowercase_key", "1INVALID", "HAS-DASH", "HAS SPACE", ""])(
    "rejects invalid secret environment variable override %j",
    (env) => {
      expect(() =>
        validateManifest({
          name: "contract-test",
          version: "2.0.0",
          secrets: {
            api_key: { required: true, description: "External API key", env },
          },
        })
      ).toThrow();
    }
  );

  it("rejects a valid environment name outside the plugin namespace", () => {
    expect(() =>
      validateManifest({
        name: "contract-test",
        version: "2.0.0",
        secrets: {
          api_key: {
            required: true,
            description: "External API key",
            env: "AGENT_API_KEY",
          },
        },
      })
    ).toThrow();
  });

  it.each(["api-key", "../key", "__proto__", "1KEY"])("rejects unsafe secret key %j", (key) => {
    expect(() =>
      validateManifest({
        name: "contract-test",
        version: "2.0.0",
        secrets: {
          [key]: { required: true, description: "External API key" },
        },
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
    { name: "valid_name", description: "Invalid approval", requiresApproval: "yes", execute },
  ])("rejects invalid tool contracts: $description", (definition) => {
    expect(validateToolDefs([definition], "contract-test")).toEqual([]);
  });

  it("keeps only the first duplicate tool name", () => {
    const definition = { name: "duplicate_tool", description: "A tool", execute };
    expect(validateToolDefs([definition, definition], "contract-test")).toHaveLength(1);
  });
});
