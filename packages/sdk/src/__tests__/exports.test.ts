import { describe, it, expect } from "vitest";
import { PLUGIN_HOOK_NAMES, TOOL_CATEGORIES, TOOL_SCOPES, PluginSDKError } from "../index.js";

describe("SDK runtime contract", () => {
  it("exports PluginSDKError with its public properties", () => {
    const err = new PluginSDKError("something broke", "OPERATION_FAILED");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PluginSDKError);
    expect(err.name).toBe("PluginSDKError");
    expect(err.code).toBe("OPERATION_FAILED");
    expect(err.message).toBe("something broke");
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({
      code: "OPERATION_FAILED",
    });
  });

  it("exports canonical runtime contract values", () => {
    expect(PLUGIN_HOOK_NAMES).toHaveLength(13);
    expect(TOOL_SCOPES).toContain("open");
    expect(TOOL_SCOPES).toContain("disabled");
    expect(TOOL_CATEGORIES).toEqual(["data-bearing", "action"]);
  });

  it("module has exactly the expected runtime exports", async () => {
    const mod = await import("../index.js");

    expect(Object.keys(mod).sort()).toEqual([
      "PLUGIN_HOOK_NAMES",
      "PluginSDKError",
      "SDK_VERSION",
      "TOOL_CATEGORIES",
      "TOOL_SCOPES",
    ]);
  });
});
