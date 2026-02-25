import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { CONFIGURABLE_KEYS } from "../configurable-keys.js";

// ── New scalar keys ─────────────────────────────────────────────────────

describe("CONFIGURABLE_KEYS — new scalar entries", () => {
  describe("agent.base_url", () => {
    const meta = CONFIGURABLE_KEYS["agent.base_url"];

    it("accepts valid URL", () => {
      expect(meta.validate("https://localhost:11434")).toBeUndefined();
    });

    it("accepts empty string (reset)", () => {
      expect(meta.validate("")).toBeUndefined();
    });

    it("rejects invalid URL", () => {
      expect(meta.validate("not-a-url")).toBeDefined();
    });
  });

  describe("telegram.owner_id", () => {
    const meta = CONFIGURABLE_KEYS["telegram.owner_id"];

    it("accepts positive integer", () => {
      expect(meta.validate("123456789")).toBeUndefined();
    });

    it("rejects negative number", () => {
      expect(meta.validate("-1")).toBeDefined();
    });

    it("rejects non-numeric", () => {
      expect(meta.validate("abc")).toBeDefined();
    });

    it("parses to number", () => {
      expect(meta.parse("123456789")).toBe(123456789);
    });
  });

  describe("telegram.max_message_length", () => {
    const meta = CONFIGURABLE_KEYS["telegram.max_message_length"];

    it("accepts within range 1-32768", () => {
      expect(meta.validate("4096")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("rejects above max", () => {
      expect(meta.validate("99999")).toBeDefined();
    });
  });

  describe("telegram.rate_limit_messages_per_second", () => {
    const meta = CONFIGURABLE_KEYS["telegram.rate_limit_messages_per_second"];

    it("accepts 0.1-10 range", () => {
      expect(meta.validate("1.5")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("telegram.rate_limit_groups_per_minute", () => {
    const meta = CONFIGURABLE_KEYS["telegram.rate_limit_groups_per_minute"];

    it("accepts 1-60 range", () => {
      expect(meta.validate("20")).toBeUndefined();
    });

    it("rejects zero", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("embedding.model", () => {
    const meta = CONFIGURABLE_KEYS["embedding.model"];

    it("accepts any non-empty string", () => {
      expect(meta.validate("all-MiniLM-L6-v2")).toBeUndefined();
    });

    it("accepts empty (reset to default)", () => {
      expect(meta.validate("")).toBeUndefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });

  describe("deals.expiry_seconds", () => {
    const meta = CONFIGURABLE_KEYS["deals.expiry_seconds"];

    it("accepts 10-3600", () => {
      expect(meta.validate("120")).toBeUndefined();
    });

    it("rejects below min", () => {
      expect(meta.validate("5")).toBeDefined();
    });
  });

  describe("deals.buy_max_floor_percent", () => {
    const meta = CONFIGURABLE_KEYS["deals.buy_max_floor_percent"];

    it("accepts 1-100", () => {
      expect(meta.validate("95")).toBeUndefined();
    });

    it("rejects above 100", () => {
      expect(meta.validate("101")).toBeDefined();
    });
  });

  describe("deals.sell_min_floor_percent", () => {
    const meta = CONFIGURABLE_KEYS["deals.sell_min_floor_percent"];

    it("accepts 100-500", () => {
      expect(meta.validate("105")).toBeUndefined();
    });

    it("rejects below 100", () => {
      expect(meta.validate("99")).toBeDefined();
    });
  });

  describe("cocoon.port", () => {
    const meta = CONFIGURABLE_KEYS["cocoon.port"];

    it("accepts 1-65535", () => {
      expect(meta.validate("10000")).toBeUndefined();
    });

    it("rejects 0", () => {
      expect(meta.validate("0")).toBeDefined();
    });

    it("description contains 'requires restart'", () => {
      expect(meta.description).toContain("requires restart");
    });
  });
});

// ── Array keys ──────────────────────────────────────────────────────────

describe("CONFIGURABLE_KEYS — array entries", () => {
  describe("telegram.admin_ids", () => {
    const meta = CONFIGURABLE_KEYS["telegram.admin_ids"];

    it("has type 'array'", () => {
      expect(meta.type).toBe("array");
    });

    it("has itemType 'number'", () => {
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("123456")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("abc")).toBeDefined();
    });

    it("rejects negative item", () => {
      expect(meta.validate("-5")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("123456")).toBe(123456);
    });
  });

  describe("telegram.allow_from", () => {
    const meta = CONFIGURABLE_KEYS["telegram.allow_from"];

    it("has type 'array' with itemType 'number'", () => {
      expect(meta.type).toBe("array");
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("999")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("xyz")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("999")).toBe(999);
    });
  });

  describe("telegram.group_allow_from", () => {
    const meta = CONFIGURABLE_KEYS["telegram.group_allow_from"];

    it("has type 'array' with itemType 'number'", () => {
      expect(meta.type).toBe("array");
      expect(meta.itemType).toBe("number");
    });

    it("validates positive integer per item", () => {
      expect(meta.validate("777")).toBeUndefined();
    });

    it("rejects non-numeric item", () => {
      expect(meta.validate("bad")).toBeDefined();
    });

    it("parses string to number", () => {
      expect(meta.parse("777")).toBe(777);
    });
  });
});

// ── Existing keys not broken ────────────────────────────────────────────

describe("existing keys unchanged", () => {
  it("all original keys still present (at least 27)", () => {
    expect(Object.keys(CONFIGURABLE_KEYS).length).toBeGreaterThanOrEqual(27);
  });

  it("agent.api_key still validates >= 10 chars", () => {
    const meta = CONFIGURABLE_KEYS["agent.api_key"];
    expect(meta.validate("short")).toBeDefined();
    expect(meta.validate("long-enough-key-here")).toBeUndefined();
  });

  it("agent.provider still has all 11 options", () => {
    const meta = CONFIGURABLE_KEYS["agent.provider"];
    expect(meta.options).toHaveLength(11);
  });
});
