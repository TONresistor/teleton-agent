import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { CONFIGURABLE_KEYS } from "../configurable-keys.js";

type ConfigurableKey = keyof typeof CONFIGURABLE_KEYS;

const VALIDATION_CASES = [
  ["agent.base_url", "https://localhost:11434", true],
  ["agent.base_url", "", true],
  ["agent.base_url", "not-a-url", false],
  ["telegram.owner_id", "123456789", true],
  ["telegram.owner_id", "-1", false],
  ["telegram.owner_id", "abc", false],
  ["telegram.max_message_length", "4096", true],
  ["telegram.max_message_length", "0", false],
  ["telegram.max_message_length", "99999", false],
  ["telegram.rate_limit_messages_per_second", "1.5", true],
  ["telegram.rate_limit_messages_per_second", "0", false],
  ["telegram.rate_limit_groups_per_minute", "20", true],
  ["telegram.rate_limit_groups_per_minute", "0", false],
  ["embedding.model", "all-MiniLM-L6-v2", true],
  ["embedding.model", "", true],
  ["gocoon.port", "10000", true],
  ["gocoon.port", "0", false],
  ["telegram.admin_ids", "123456", true],
  ["telegram.admin_ids", "abc", false],
  ["telegram.admin_ids", "-5", false],
  ["telegram.allow_from", "999", true],
  ["telegram.allow_from", "xyz", false],
  ["telegram.group_allow_from", "777", true],
  ["telegram.group_allow_from", "bad", false],
] as const satisfies ReadonlyArray<readonly [ConfigurableKey, string, boolean]>;

const PARSE_CASES = [
  ["telegram.owner_id", "123456789", 123456789],
  ["telegram.admin_ids", "123456", 123456],
  ["telegram.allow_from", "999", 999],
  ["telegram.group_allow_from", "777", 777],
] as const satisfies ReadonlyArray<readonly [ConfigurableKey, string, number]>;

const ARRAY_KEYS = [
  "telegram.admin_ids",
  "telegram.allow_from",
  "telegram.group_allow_from",
] as const satisfies ReadonlyArray<ConfigurableKey>;

const RESTART_KEYS = [
  "telegram.rate_limit_messages_per_second",
  "telegram.rate_limit_groups_per_minute",
  "embedding.model",
  "gocoon.port",
] as const satisfies ReadonlyArray<ConfigurableKey>;

describe("CONFIGURABLE_KEYS", () => {
  it.each(VALIDATION_CASES)("%s validation for %j is %s", (key, input, isValid) => {
    const result = CONFIGURABLE_KEYS[key].validate(input);
    if (isValid) expect(result).toBeUndefined();
    else expect(result).toBeDefined();
  });

  it.each(PARSE_CASES)("%s parses %j", (key, input, expected) => {
    expect(CONFIGURABLE_KEYS[key].parse(input)).toBe(expected);
  });

  it.each(ARRAY_KEYS)("%s exposes numeric array metadata", (key) => {
    expect(CONFIGURABLE_KEYS[key]).toMatchObject({
      type: "array",
      itemType: "number",
    });
  });

  it.each(RESTART_KEYS)("%s documents its restart requirement", (key) => {
    expect(CONFIGURABLE_KEYS[key].description).toContain("requires restart");
  });

  it("keeps the existing configurable surface", () => {
    expect(Object.keys(CONFIGURABLE_KEYS).length).toBeGreaterThanOrEqual(27);

    const apiKey = CONFIGURABLE_KEYS["agent.api_key"];
    expect(apiKey.validate("short")).toBeDefined();
    expect(apiKey.validate("long-enough-key-here")).toBeUndefined();

    expect(CONFIGURABLE_KEYS["agent.provider"].options).toHaveLength(16);
  });
});
