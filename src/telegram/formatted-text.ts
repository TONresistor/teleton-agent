import { Parser } from "htmlparser2";
import { markdownToTelegramHtml } from "./formatting.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../constants/limits.js";

export interface TelegramTextEntity {
  type:
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "spoiler"
    | "code"
    | "pre"
    | "text_link"
    | "blockquote"
    | "expandable_blockquote";
  offset: number;
  length: number;
  url?: string;
  language?: string;
}
export interface FormattedTelegramText {
  text: string;
  entities: TelegramTextEntity[];
}
/** Parse the converter's HTML once, then split decoded text with UTF-16 entity offsets. */
export function parseTelegramHtml(html: string): FormattedTelegramText {
  let text = "";
  const entities: TelegramTextEntity[] = [];
  const stack: Array<{ tag: string; entity?: TelegramTextEntity }> = [];
  const kinds: Record<string, TelegramTextEntity["type"]> = {
    b: "bold",
    strong: "bold",
    i: "italic",
    em: "italic",
    u: "underline",
    s: "strikethrough",
    strike: "strikethrough",
    del: "strikethrough",
    "tg-spoiler": "spoiler",
    code: "code",
    pre: "pre",
    a: "text_link",
    blockquote: "blockquote",
  };
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (tag === "br") {
          text += "\n";
          return;
        }
        let type = kinds[tag];
        if (tag === "blockquote" && "expandable" in attrs) type = "expandable_blockquote";
        if (tag === "code" && stack.some((entry) => entry.tag === "pre")) {
          const pre = stack[stack.map((entry) => entry.tag).lastIndexOf("pre")]?.entity;
          if (pre && attrs.class?.startsWith("language-")) pre.language = attrs.class.slice(9);
          stack.push({ tag });
          return;
        }
        const entity = type
          ? { type, offset: text.length, length: 0, ...(tag === "a" ? { url: attrs.href } : {}) }
          : undefined;
        stack.push({ tag, entity });
      },
      ontext(value) {
        text += value;
      },
      onclosetag(tag) {
        const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
        if (index < 0) return;
        for (const entry of stack.splice(index)) {
          if (entry.entity) {
            entry.entity.length = text.length - entry.entity.offset;
            if (entry.entity.length) entities.push(entry.entity);
          }
        }
      },
    },
    { decodeEntities: true }
  );
  parser.write(html);
  parser.end();
  return { text, entities: entities.sort((a, b) => a.offset - b.offset || b.length - a.length) };
}
function safeEnd(text: string, end: number): number {
  if (
    end > 0 &&
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    return end - 1;
  return end;
}
export function splitFormattedText(
  value: FormattedTelegramText,
  limit = TELEGRAM_MAX_MESSAGE_LENGTH
): FormattedTelegramText[] {
  if (limit < 2) throw new Error("Telegram fragment limit must be at least two UTF-16 units");
  const fragments: FormattedTelegramText[] = [];
  for (let start = 0; start < value.text.length;) {
    const end = safeEnd(value.text, Math.min(start + limit, value.text.length));
    const entities = value.entities.flatMap((entity) => {
      const left = Math.max(start, entity.offset),
        right = Math.min(end, entity.offset + entity.length);
      return right > left ? [{ ...entity, offset: left - start, length: right - left }] : [];
    });
    fragments.push({ text: value.text.slice(start, end), entities });
    start = end;
  }
  return fragments;
}
export function prepareTelegramText(
  markdown: string,
  limit = TELEGRAM_MAX_MESSAGE_LENGTH
): FormattedTelegramText[] {
  return splitFormattedText(parseTelegramHtml(markdownToTelegramHtml(markdown)), limit);
}
/** Guest API admits one answer: preserve valid text and state truncation explicitly. */
export function guestReplyHtml(markdown: string, limit = TELEGRAM_MAX_MESSAGE_LENGTH): string {
  const value = parseTelegramHtml(markdownToTelegramHtml(markdown));
  const suffix = "\n[Response truncated]";
  const text =
    value.text.length > limit
      ? value.text.slice(0, safeEnd(value.text, limit - suffix.length)) + suffix
      : value.text;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
