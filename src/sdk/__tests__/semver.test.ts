import { describe, it, expect } from "vitest";
import { semverSatisfies } from "../index.js";

describe("semverSatisfies", () => {
  describe("exact match", () => {
    it("returns true for identical versions", () => {
      expect(semverSatisfies("1.2.3", "1.2.3")).toBe(true);
    });

    it("returns false when patch differs", () => {
      expect(semverSatisfies("1.2.3", "1.2.4")).toBe(false);
    });

    it("returns false when minor differs", () => {
      expect(semverSatisfies("1.2.3", "1.3.3")).toBe(false);
    });

    it("returns false when major differs", () => {
      expect(semverSatisfies("1.2.3", "2.2.3")).toBe(false);
      expect(semverSatisfies("2.0.0", "1.0.0")).toBe(false);
    });

    it("matches 0.0.0 exactly", () => {
      expect(semverSatisfies("0.0.0", "0.0.0")).toBe(true);
      expect(semverSatisfies("0.0.1", "0.0.0")).toBe(false);
    });
  });

  describe(">= range", () => {
    it("returns true when current equals required", () => {
      expect(semverSatisfies("1.0.0", ">=1.0.0")).toBe(true);
    });

    it("returns true when current is greater (patch)", () => {
      expect(semverSatisfies("1.0.1", ">=1.0.0")).toBe(true);
    });

    it("returns true when current is greater (minor)", () => {
      expect(semverSatisfies("1.1.0", ">=1.0.0")).toBe(true);
    });

    it("returns true when current is greater (major)", () => {
      expect(semverSatisfies("2.0.0", ">=1.0.0")).toBe(true);
    });

    it("returns false when current is lesser (patch)", () => {
      expect(semverSatisfies("1.0.0", ">=1.0.1")).toBe(false);
    });

    it("returns false when current is lesser (minor)", () => {
      expect(semverSatisfies("1.0.9", ">=1.1.0")).toBe(false);
    });

    it("returns false when current is lesser (major)", () => {
      expect(semverSatisfies("0.9.9", ">=1.0.0")).toBe(false);
    });

    it("handles >=0.0.0", () => {
      expect(semverSatisfies("0.0.0", ">=0.0.0")).toBe(true);
      expect(semverSatisfies("0.0.1", ">=0.0.0")).toBe(true);
    });
  });

  describe("^ caret range", () => {
    it("allows same major with higher minor", () => {
      expect(semverSatisfies("1.3.0", "^1.2.0")).toBe(true);
    });

    it("allows same major with higher patch", () => {
      expect(semverSatisfies("1.2.5", "^1.2.3")).toBe(true);
    });

    it("allows exact match", () => {
      expect(semverSatisfies("1.2.3", "^1.2.3")).toBe(true);
    });

    it("rejects next major", () => {
      expect(semverSatisfies("2.0.0", "^1.2.3")).toBe(false);
    });

    it("rejects previous major", () => {
      expect(semverSatisfies("0.9.9", "^1.0.0")).toBe(false);
    });

    it("rejects lower minor.patch within same major", () => {
      expect(semverSatisfies("1.2.2", "^1.2.3")).toBe(false);
      expect(semverSatisfies("1.1.9", "^1.2.0")).toBe(false);
    });
  });

  describe("^0.x special (npm 0.x semantics)", () => {
    it("allows higher patch within same 0.minor", () => {
      expect(semverSatisfies("0.3.1", "^0.3.0")).toBe(true);
      expect(semverSatisfies("0.3.9", "^0.3.0")).toBe(true);
    });

    it("allows exact match", () => {
      expect(semverSatisfies("0.3.0", "^0.3.0")).toBe(true);
    });

    it("rejects next minor in 0.x", () => {
      expect(semverSatisfies("0.4.0", "^0.3.0")).toBe(false);
    });

    it("rejects previous minor in 0.x", () => {
      expect(semverSatisfies("0.2.9", "^0.3.0")).toBe(false);
    });

    it("rejects major 1 for ^0.x", () => {
      expect(semverSatisfies("1.0.0", "^0.3.0")).toBe(false);
    });

    it("rejects lower patch within same 0.minor", () => {
      expect(semverSatisfies("0.3.0", "^0.3.1")).toBe(false);
    });

    it("handles ^0.0.x (locks to exact patch in implementation)", () => {
      expect(semverSatisfies("0.0.1", "^0.0.1")).toBe(true);
      expect(semverSatisfies("0.0.2", "^0.0.1")).toBe(false);
      expect(semverSatisfies("0.0.0", "^0.0.1")).toBe(false);
      expect(semverSatisfies("0.1.0", "^0.0.1")).toBe(false);
    });
  });

  describe("malformed current version (fail-closed)", () => {
    it("returns false for 'abc'", () => {
      expect(semverSatisfies("abc", "1.0.0")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(semverSatisfies("", "1.0.0")).toBe(false);
    });

    it("returns false for partial version '1.2'", () => {
      expect(semverSatisfies("1.2", "1.0.0")).toBe(false);
    });
  });

  describe("malformed range (fail-closed)", () => {
    it("returns false for '>=abc'", () => {
      expect(semverSatisfies("1.0.0", ">=abc")).toBe(false);
    });

    it("returns false for '^' alone", () => {
      expect(semverSatisfies("1.0.0", "^")).toBe(false);
    });

    it("rejects unsupported tilde ranges", () => {
      expect(semverSatisfies("1.0.0", "~1.0.0")).toBe(false);
      expect(semverSatisfies("1.0.1", "~1.0.0")).toBe(false);
    });

    it("returns false for empty range", () => {
      expect(semverSatisfies("1.0.0", "")).toBe(false);
    });

    it("returns false for completely invalid range", () => {
      expect(semverSatisfies("1.0.0", "not-a-version")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles 0.0.0 as current with various ranges", () => {
      expect(semverSatisfies("0.0.0", ">=0.0.0")).toBe(true);
      expect(semverSatisfies("0.0.0", ">=0.0.1")).toBe(false);
      expect(semverSatisfies("0.0.0", "^0.0.0")).toBe(true);
    });

    it("handles large version numbers", () => {
      expect(semverSatisfies("100.200.300", "100.200.300")).toBe(true);
      expect(semverSatisfies("100.200.300", ">=50.0.0")).toBe(true);
      expect(semverSatisfies("100.200.300", "^100.0.0")).toBe(true);
    });

    it("rejects versions embedded in another string", () => {
      expect(semverSatisfies("v1.2.3", "1.2.3")).toBe(false);
    });
  });
});
