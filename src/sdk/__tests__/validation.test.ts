import { describe, expect, it } from "vitest";
import {
  boundedLimit,
  requireNonEmpty,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requirePositiveNumber,
} from "../validation.js";

describe("SDK input validation", () => {
  it("normalizes required strings", () => {
    expect(requireNonEmpty("  hello  ", "Value")).toBe("hello");
    expect(() => requireNonEmpty("  ", "Value")).toThrow("Value must not be empty");
  });

  it("validates integer ranges", () => {
    expect(requirePositiveInteger(1, "Count")).toBe(1);
    expect(requireNonNegativeInteger(0, "Index")).toBe(0);
    for (const value of [Number.NaN, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => requirePositiveInteger(value, "Count")).toThrow();
    }
  });

  it("validates positive finite numbers", () => {
    expect(requirePositiveNumber(0.1, "Amount")).toBe(0.1);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => requirePositiveNumber(value, "Amount")).toThrow();
    }
  });

  it("applies a default and maximum to limits", () => {
    expect(boundedLimit(undefined, 20, 100)).toBe(20);
    expect(boundedLimit(500, 20, 100)).toBe(100);
    expect(() => boundedLimit(0, 20, 100)).toThrow();
  });
});
