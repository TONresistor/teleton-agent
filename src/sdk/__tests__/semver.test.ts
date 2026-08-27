import { describe, expect, it } from "vitest";
import { semverSatisfies } from "../index.js";

const CASES = [
  ["identical versions", "1.2.3", "1.2.3", true],
  ["different patch", "1.2.3", "1.2.4", false],
  ["different minor", "1.2.3", "1.3.3", false],
  ["different major", "1.2.3", "2.2.3", false],
  ["higher major against exact range", "2.0.0", "1.0.0", false],
  ["zero version exact match", "0.0.0", "0.0.0", true],
  ["zero version patch mismatch", "0.0.1", "0.0.0", false],

  [">= equal", "1.0.0", ">=1.0.0", true],
  [">= higher patch", "1.0.1", ">=1.0.0", true],
  [">= higher minor", "1.1.0", ">=1.0.0", true],
  [">= higher major", "2.0.0", ">=1.0.0", true],
  [">= lower patch", "1.0.0", ">=1.0.1", false],
  [">= lower minor", "1.0.9", ">=1.1.0", false],
  [">= lower major", "0.9.9", ">=1.0.0", false],
  [">= zero equal", "0.0.0", ">=0.0.0", true],
  [">= zero higher patch", "0.0.1", ">=0.0.0", true],

  ["caret higher minor", "1.3.0", "^1.2.0", true],
  ["caret higher patch", "1.2.5", "^1.2.3", true],
  ["caret exact match", "1.2.3", "^1.2.3", true],
  ["caret next major", "2.0.0", "^1.2.3", false],
  ["caret previous major", "0.9.9", "^1.0.0", false],
  ["caret lower patch", "1.2.2", "^1.2.3", false],
  ["caret lower minor", "1.1.9", "^1.2.0", false],

  ["caret 0.x higher patch", "0.3.1", "^0.3.0", true],
  ["caret 0.x much higher patch", "0.3.9", "^0.3.0", true],
  ["caret 0.x exact match", "0.3.0", "^0.3.0", true],
  ["caret 0.x next minor", "0.4.0", "^0.3.0", false],
  ["caret 0.x previous minor", "0.2.9", "^0.3.0", false],
  ["caret 0.x next major", "1.0.0", "^0.3.0", false],
  ["caret 0.x lower patch", "0.3.0", "^0.3.1", false],
  ["caret 0.0.x exact patch", "0.0.1", "^0.0.1", true],
  ["caret 0.0.x higher patch", "0.0.2", "^0.0.1", false],
  ["caret 0.0.x lower patch", "0.0.0", "^0.0.1", false],
  ["caret 0.0.x higher minor", "0.1.0", "^0.0.1", false],

  ["malformed current text", "abc", "1.0.0", false],
  ["empty current", "", "1.0.0", false],
  ["partial current", "1.2", "1.0.0", false],
  ["malformed >= range", "1.0.0", ">=abc", false],
  ["empty caret range", "1.0.0", "^", false],
  ["unsupported tilde equal", "1.0.0", "~1.0.0", false],
  ["unsupported tilde higher", "1.0.1", "~1.0.0", false],
  ["empty range", "1.0.0", "", false],
  ["invalid range text", "1.0.0", "not-a-version", false],
  ["embedded version prefix", "v1.2.3", "1.2.3", false],

  ["zero satisfies zero floor", "0.0.0", ">=0.0.0", true],
  ["zero misses patch floor", "0.0.0", ">=0.0.1", false],
  ["zero satisfies zero caret", "0.0.0", "^0.0.0", true],
  ["large exact version", "100.200.300", "100.200.300", true],
  ["large version above floor", "100.200.300", ">=50.0.0", true],
  ["large version within caret major", "100.200.300", "^100.0.0", true],
] as const;

describe("semverSatisfies", () => {
  it.each(CASES)("%s", (_label, current, range, expected) => {
    expect(semverSatisfies(current, range)).toBe(expected);
  });
});
