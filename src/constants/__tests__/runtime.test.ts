import { describe, expect, it } from "vitest";
import { MINIMUM_NODE_VERSION, SUPPORTED_NODE_RANGE, isNodeVersionSupported } from "../runtime.js";

describe("Node.js runtime contract", () => {
  it("matches the production dependency runtime range", () => {
    expect(MINIMUM_NODE_VERSION).toBe("22.23.5");
    expect(SUPPORTED_NODE_RANGE).toBe("^22.23.5 || ^24.22.3 || >=26.13.1");
  });

  it.each([
    ["v22.22.2", false],
    ["v22.23.2", false],
    ["v22.23.3", false],
    ["v22.23.4", false],
    ["v22.23.5", true],
    ["22.23.5", true],
    ["22.23.5-rc.1", false],
    ["22.23.5+build.1", true],
    ["22.23.6", true],
    ["v23.0.0", false],
    ["v24.15.0", false],
    ["v24.22.0", false],
    ["v24.22.1", false],
    ["v24.22.2", false],
    ["v24.22.3", true],
    ["v24.22.3-rc.1", false],
    ["v25.0.0", false],
    ["v26.0.0", false],
    ["v26.12.0", false],
    ["v26.12.1", false],
    ["v26.13.0", false],
    ["v26.13.1", true],
    ["v27.0.0", true],
    ["v26.13.1-rc.1", false],
    ["invalid", false],
  ])("evaluates %s", (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected);
  });
});
