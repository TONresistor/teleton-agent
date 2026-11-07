import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import {
  PLUGIN_HOOK_NAMES,
  TOOL_CATEGORIES,
  TOOL_MODES,
  TOOL_SCOPES,
  PluginSDKError,
} from "../index.js";

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

  it("recognizes SDK errors from a separate copy and JavaScript realm", () => {
    const error: unknown = runInNewContext(`new (class PluginSDKError extends Error {
      name = "PluginSDKError";
      code = "NOT_AVAILABLE";
    })("Unavailable in this mode")`);

    expect(error instanceof Error).toBe(false);
    expect(error).toBeInstanceOf(PluginSDKError);
  });

  it.each([
    null,
    undefined,
    "error",
    42,
    new Error("ordinary error"),
    { name: "OtherError", message: "error", code: "NOT_AVAILABLE" },
    { name: "PluginSDKError", message: "error", code: "UNKNOWN" },
    { name: "PluginSDKError", message: "error", code: 42 },
    { name: "PluginSDKError", code: "NOT_AVAILABLE" },
  ])("rejects values outside the SDK error contract: %j", (value) => {
    expect(value).not.toBeInstanceOf(PluginSDKError);
  });

  it("preserves native subclass identity", () => {
    class CustomSDKError extends PluginSDKError {}
    const parent = new PluginSDKError("parent", "OPERATION_FAILED");
    const child = new CustomSDKError("child", "OPERATION_FAILED");

    expect(child).toBeInstanceOf(PluginSDKError);
    expect(child).toBeInstanceOf(CustomSDKError);
    expect(parent).not.toBeInstanceOf(CustomSDKError);
  });

  it("exports canonical runtime contract values", () => {
    expect(PLUGIN_HOOK_NAMES).toHaveLength(13);
    expect(TOOL_SCOPES).toContain("open");
    expect(TOOL_SCOPES).toContain("disabled");
    expect(TOOL_CATEGORIES).toEqual(["data-bearing", "action"]);
    expect(TOOL_MODES).toEqual(["user", "bot", "both"]);
  });

  it("module has exactly the expected runtime exports", async () => {
    const mod = await import("../index.js");

    expect(Object.keys(mod).sort()).toEqual([
      "PLUGIN_HOOK_NAMES",
      "PluginSDKError",
      "SDK_VERSION",
      "TOOL_CATEGORIES",
      "TOOL_MODES",
      "TOOL_SCOPES",
    ]);
  });
});
