import { describe, expect, it } from "vitest";
import { parseToolArguments } from "../tool-arguments.js";

describe("parseToolArguments", () => {
  it("preserves nested JSON arguments", () => {
    const args = { text: "hello", flags: [true, null, 3], filter: { enabled: false } };
    expect(parseToolArguments(args)).toEqual(args);
  });

  it.each([
    null,
    [],
    "text",
    { value: undefined },
    { value: NaN },
    { value: 1n },
    { value: new Date() },
    { value: () => "no" },
  ])("rejects non-JSON object input %#", (value) => {
    expect(() => parseToolArguments(value)).toThrow();
  });
});
