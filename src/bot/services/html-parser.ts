/**
 * Simple HTML → MessageEntity parser for MTProto
 * Converts our limited HTML subset (<b>, <i>, <code>, <a href="...">) to
 * plain text + Telegram MessageEntity array.
 *
 * Entity offsets use UTF-16 code units (matching Telegram's spec and JS string.length).
 */

import { Api } from "telegram";
import bigInt from "big-integer";

export interface ParsedMessage {
  text: string;
  entities: Api.TypeMessageEntity[];
}

/**
 * Parse HTML string to plain text + MessageEntity array
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
                        documentId: bigInt(open.emojiId),
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
          if (hrefMatch) url = unescapeHtml(hrefMatch[1]);
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
