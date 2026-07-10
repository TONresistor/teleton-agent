import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import {
  compileGlob,
  hasStyledButtons,
  parseHtml,
  prefixButtons,
  stripCustomEmoji,
  toGrammyKeyboard,
  toTLMarkup,
} from "../formatting.js";

describe("SDK formatting helpers", () => {
  it("builds TL callback, styled, and copy buttons while dropping empty rows", () => {
    const markup = toTLMarkup([
      [],
      [
        { text: "Confirm", callbackData: "confirm:1", style: "success" },
        { text: "Copy", callbackData: "", copyText: "EQ123" },
      ],
    ]);

    expect(markup).toBeInstanceOf(Api.ReplyInlineMarkup);
    expect(markup.rows).toHaveLength(1);
    expect(markup.rows[0].buttons[0]).toBeInstanceOf(Api.KeyboardButtonCallback);
    expect(markup.rows[0].buttons[1]).toBeInstanceOf(Api.KeyboardButtonCopy);
  });

  it("builds the Grammy fallback with callback and copy rows", () => {
    const keyboard = toGrammyKeyboard([
      [{ text: "Confirm", callbackData: "confirm:1" }],
      [{ text: "Copy", callbackData: "", copyText: "EQ123" }],
    ]);

    expect(keyboard.inline_keyboard).toEqual([
      [{ text: "Confirm", callback_data: "confirm:1" }],
      [{ text: "Copy", copy_text: { text: "EQ123" } }],
    ]);
  });

  it("detects buttons and prefixes only callback payloads", () => {
    expect(hasStyledButtons([[], [{ text: "A", callbackData: "a" }]])).toBe(true);
    expect(hasStyledButtons([[]])).toBe(false);

    expect(
      prefixButtons(
        [
          [
            { text: "Open", callback: "open", style: "primary" },
            { text: "Copy", copy: "value" },
          ],
        ],
        "demo"
      )
    ).toEqual([
      [
        { text: "Open", callbackData: "demo:open", style: "primary" },
        { text: "Copy", callbackData: "", copyText: "value", style: undefined },
      ],
    ]);
  });

  it("parses supported HTML entities with Telegram UTF-16 offsets", () => {
    const parsed = parseHtml(
      '<b>Bold</b> <i>Italic</i> <code>x</code> <a href="https://example.com?a=1&amp;b=2">Link</a> <tg-emoji emoji-id="123">⭐</tg-emoji>'
    );

    expect(parsed.text).toBe("Bold Italic x Link ⭐");
    expect(parsed.entities).toHaveLength(5);
    expect(parsed.entities[0]).toBeInstanceOf(Api.MessageEntityBold);
    expect(parsed.entities[1]).toBeInstanceOf(Api.MessageEntityItalic);
    expect(parsed.entities[2]).toBeInstanceOf(Api.MessageEntityCode);
    expect(parsed.entities[3]).toMatchObject({ url: "https://example.com?a=1&b=2" });
    expect(parsed.entities[4]).toBeInstanceOf(Api.MessageEntityCustomEmoji);
  });

  it("handles malformed, nested, unknown, and unsafe HTML without executing URLs", () => {
    expect(parseHtml("a < broken").text).toBe("a < broken");
    expect(parseHtml("<strong>A</strong><em>B</em>").entities).toHaveLength(2);
    expect(parseHtml('<a href="javascript:alert(1)">bad</a>').entities[0]).toMatchObject({
      url: "#",
    });
    expect(parseHtml("&lt;&gt;&quot;&amp;").text).toBe('<>"&');
    expect(parseHtml("<unknown>x</unknown>")).toMatchObject({ text: "x", entities: [] });
  });

  it("strips custom emoji wrappers and compiles escaped glob patterns", () => {
    expect(stripCustomEmoji('<tg-emoji emoji-id="1">⭐</tg-emoji> ok')).toBe("⭐ ok");

    const regex = compileGlob("item.+:*");
    expect(regex.test("item.+:123")).toBe(true);
    expect(regex.test("itemXX:123")).toBe(false);
  });
});
