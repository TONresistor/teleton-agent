import { describe, expect, it } from "vitest";
import { MINIMUM_NODE_VERSION, SUPPORTED_NODE_RANGE, isNodeVersionSupported } from "../runtime.js";

describe("Node.js runtime contract", () => {
  it("pins the minimum version required by production dependencies", () => {
    expect(MINIMUM_NODE_VERSION).toBe("22.22.2");
    expect(SUPPORTED_NODE_RANGE).toBe("^22.22.2 || ^24.15.0 || >=26.0.0");
  });

  it.each([
    ["v22.22.1", false],
    ["v22.22.2", true],
    ["22.23.0", true],
    ["v23.0.0", false],
    ["v24.14.9", false],
    ["v24.15.0", true],
    ["v25.0.0", false],
    ["v26.0.0", true],
    ["invalid", false],
  ])("evaluates %s", (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected);
  });
});
