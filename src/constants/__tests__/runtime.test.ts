import { describe, expect, it } from "vitest";
import { SUPPORTED_NODE_VERSION, isNodeVersionSupported } from "../runtime.js";

describe("Node.js runtime contract", () => {
  it("pins the production runtime version", () => {
    expect(SUPPORTED_NODE_VERSION).toBe("22.22.2");
  });

  it.each([
    ["v22.22.1", false],
    ["v22.22.2", true],
    ["22.22.2", true],
    ["22.22.3", false],
    ["v23.0.0", false],
    ["v24.15.0", false],
    ["invalid", false],
  ])("evaluates %s", (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected);
  });
});
