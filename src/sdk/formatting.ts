/**
 * Pure formatting helpers shared across the bot transport layer and the plugin
 * bot SDK. These functions have no module-level state and depend only on the
 * Telegram/Grammy primitives — they live in sdk/ (the reusable layer) so that
 * sdk/bot.ts no longer has to reach into the concrete bot/ layer for them.
 *
 * Contents:
 *   - Styled keyboard conversion (TL markup, Grammy keyboard, plugin prefixing)
 *   - HTML → MessageEntity parsing for MTProto
 *   - Glob → RegExp compilation for callback routing
 */

import { Api } from "telegram";
import { InlineKeyboard } from "grammy";
import { toLong } from "../utils/gramjs-bigint.js";

// ── Styled keyboard ──────────────────────────────────────────────────────────

export type ButtonStyle = "success" | "danger" | "primary";

export interface StyledButtonDef {
  text: string;
  callbackData: string;
  style?: ButtonStyle;
  /** If set, renders as KeyboardButtonCopy (click-to-clipboard) via MTProto */
  copyText?: string;
}

/**
 * Convert styled button definitions to GramJS TL markup (with colors + copy buttons)
 * Uses native Layer 223 constructors (KeyboardButtonStyle, KeyboardButtonCopy)
 */
export function toTLMarkup(buttons: StyledButtonDef[][]): Api.ReplyInlineMarkup {
  return new Api.ReplyInlineMarkup({
    rows: buttons
      .filter((row) => row.length > 0)
      .map(
        (row) =>
          new Api.KeyboardButtonRow({
            buttons: row.map((btn) => {
              // Copy button: native click-to-clipboard (no callback needed)
              if (btn.copyText) {
                return new Api.KeyboardButtonCopy({
                  text: btn.text,
                  copyText: btn.copyText,
                });
              }

              // Callback button: with optional color style
              const style = btn.style
                ? new Api.KeyboardButtonStyle({
                    bgSuccess: btn.style === "success",
                    bgDanger: btn.style === "danger",
                    bgPrimary: btn.style === "primary",
                  })
                : undefined;
              return new Api.KeyboardButtonCallback({
                text: btn.text,
                data: Buffer.from(btn.callbackData),
                style,
              });
            }),
          })
      ),
  });
}

/**
 * Convert styled button definitions to Grammy InlineKeyboard (fallback, no colors)
 * Copy buttons use Bot API's native copy_text field (click-to-clipboard)
 */
export function toGrammyKeyboard(buttons: StyledButtonDef[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < buttons.length; i++) {
    if (i > 0) kb.row();
    for (const btn of buttons[i]) {
      if (btn.copyText) {
        kb.copyText(btn.text, btn.copyText);
      } else {
        kb.text(btn.text, btn.callbackData);
      }
    }
  }
  return kb;
}

/**
 * Check if button array has any buttons
 */
export function hasStyledButtons(buttons: StyledButtonDef[][]): boolean {
  return buttons.some((row) => row.length > 0);
}

/**
 * Convert plugin ButtonDef[][] to StyledButtonDef[][] with prefixed callbacks.
 * Shared by both sdk/bot.ts and bot/inline-router.ts.
 */
export function prefixButtons(
  rows: { text: string; callback?: string; url?: string; copy?: string; style?: ButtonStyle }[][],
  pluginName: string
): StyledButtonDef[][] {
  return rows.map((row) =>
    row.map((btn) => {
      if (btn.copy) {
        return { text: btn.text, callbackData: "", copyText: btn.copy, style: btn.style };
      }
      return {
        text: btn.text,
        callbackData: btn.callback ? `${pluginName}:${btn.callback}` : "",
        style: btn.style,
      };
    })
  );
}

// ── HTML parsing ─────────────────────────────────────────────────────────────

export interface ParsedMessage {
  text: string;
  entities: Api.TypeMessageEntity[];
}

/**
 * Parse HTML string to plain text + MessageEntity array.
 *
 * Converts our limited HTML subset (<b>, <i>, <code>, <a href="...">, <tg-emoji>)
 * to plain text + Telegram MessageEntity array. Entity offsets use UTF-16 code
 * units (matching Telegram's spec and JS string.length).
 */
export function parseHtml(html: string): ParsedMessage {
  const entities: Api.TypeMessageEntity[] = [];
  let text = "";
  let pos = 0;

  // Stack for tracking open tags
  const stack: { tag: string; offset: number; url?: string; emojiId?: string }[] = [];

  while (pos < html.length) {
    if (html[pos] === "<") {
      const endBracket = html.indexOf(">", pos);
      if (endBracket === -1) {
        // Malformed HTML - treat '<' as literal
        text += "<";
        pos++;
        continue;
      }

      const tagStr = html.substring(pos + 1, endBracket);

      if (tagStr.startsWith("/")) {
        // Closing tag
        const tagName = tagStr.substring(1).toLowerCase().trim();
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tagName) {
            const open = stack[i];
            const length = text.length - open.offset;

            if (length > 0) {
              switch (tagName) {
                case "b":
                case "strong":
                  entities.push(new Api.MessageEntityBold({ offset: open.offset, length }));
                  break;
                case "i":
                case "em":
                  entities.push(new Api.MessageEntityItalic({ offset: open.offset, length }));
                  break;
                case "code":
                  entities.push(new Api.MessageEntityCode({ offset: open.offset, length }));
                  break;
                case "a":
                  if (open.url) {
                    entities.push(
                      new Api.MessageEntityTextUrl({
                        offset: open.offset,
                        length,
                        url: open.url,
                      })
                    );
                  }
                  break;
                case "tg-emoji":
                  if (open.emojiId) {
                    entities.push(
                      new Api.MessageEntityCustomEmoji({
                        offset: open.offset,
                        length,
                        documentId: toLong(open.emojiId),
                      })
                    );
                  }
                  break;
              }
            }

            stack.splice(i, 1);
            break;
          }
        }
      } else {
        // Opening tag
        const spaceIdx = tagStr.indexOf(" ");
        const tagName = (spaceIdx >= 0 ? tagStr.substring(0, spaceIdx) : tagStr).toLowerCase();
        const attrs = spaceIdx >= 0 ? tagStr.substring(spaceIdx) : "";

        let url: string | undefined;
        let emojiId: string | undefined;
        if (tagName === "a") {
          const hrefMatch = attrs.match(/href="([^"]+)"/);
          if (hrefMatch) {
            const rawUrl = unescapeHtml(hrefMatch[1]);
            if (/^(javascript|data|vbscript|file):/i.test(rawUrl.trim())) {
              url = "#";
            } else {
              url = rawUrl;
            }
          }
        } else if (tagName === "tg-emoji") {
          const eidMatch = attrs.match(/emoji-id="([^"]+)"/);
          if (eidMatch) emojiId = eidMatch[1];
        }

        stack.push({ tag: tagName, offset: text.length, url, emojiId });
      }

      pos = endBracket + 1;
    } else if (html.substring(pos, pos + 5) === "&amp;") {
      text += "&";
      pos += 5;
    } else if (html.substring(pos, pos + 4) === "&lt;") {
      text += "<";
      pos += 4;
    } else if (html.substring(pos, pos + 4) === "&gt;") {
      text += ">";
      pos += 4;
    } else if (html.substring(pos, pos + 6) === "&quot;") {
      text += '"';
      pos += 6;
    } else {
      text += html[pos];
      pos++;
    }
  }

  return { text, entities };
}

/**
 * Strip <tg-emoji> tags for Grammy/Bot API fallback (keeps unicode emoji inside)
 */
export function stripCustomEmoji(html: string): string {
  return html.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, "$1");
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// ── Glob compilation ─────────────────────────────────────────────────────────

/**
 * Compile a glob-like pattern to a RegExp.
 * Supports `*` as wildcard matching any sequence of characters.
 */
export function compileGlob(pattern: string): RegExp {
  const regexStr = "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)") + "$";
  return new RegExp(regexStr);
}
