import { describe, expect, it } from "vitest";
import {
  guestReplyHtml,
  parseTelegramHtml,
  prepareTelegramText,
  splitFormattedText,
} from "../formatted-text.js";

describe("Telegram formatted text fragments", () => {
  it("keeps nested formatting, entities and surrogate pairs over boundaries", () => {
    const value = parseTelegramHtml(
      '<b>A😀&amp;<a href="https://example.com/long">' + "é".repeat(20) + "</a></b>"
    );
    const parts = splitFormattedText(value, 8);
    expect(parts.map((part) => part.text).join("")).toBe(value.text);
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(8);
      expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      expect(
        part.entities.every(
          (entity) => entity.offset >= 0 && entity.offset + entity.length <= part.text.length
        )
      ).toBe(true);
    }
    expect(parts[0].entities.some((entity) => entity.type === "bold")).toBe(true);
    expect(parts.at(-1)!.entities.some((entity) => entity.type === "text_link")).toBe(true);
  });
  it("preserves code language and whitespace without slicing HTML", () => {
    const parts = prepareTelegramText("```typescript\n" + "x & < y\n".repeat(1000) + "```");
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts.every((part) =>
        part.entities.some((entity) => entity.type === "pre" && entity.language === "typescript")
      )
    ).toBe(true);
    expect(parts.map((part) => part.text).join("")).toBe("x & < y\n".repeat(1000).trim());
  });
  it("truncates a guest answer with valid escaped text and an explicit notice", () => {
    const html = guestReplyHtml("**" + "<&😀".repeat(3000) + "**");
    const parsed = parseTelegramHtml(html);
    expect(parsed.text.length).toBeLessThanOrEqual(4096);
    expect(parsed.text.endsWith("[Response truncated]")).toBe(true);
    expect(html).not.toContain("<b>");
  });
});
