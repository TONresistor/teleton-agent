/**
 * Styled keyboard helpers for deal buttons
 * Converts button definitions to GramJS TL objects (with color styles + copy buttons)
 * or Grammy InlineKeyboard (fallback, no colors, popup copy)
 */

import { Api } from "telegram";
import { InlineKeyboard } from "grammy";

export type ButtonStyle = "success" | "danger" | "primary";

export interface StyledButtonDef {
  text: string;
  callbackData: string;
  style?: ButtonStyle;
  /** If set, renders as KeyboardButtonCopy (click-to-clipboard) via MTProto */
  copyText?: string;
}

/**
 * Result type for all message builders
 */
export interface DealMessage {
  text: string;
  buttons: StyledButtonDef[][];
}

/**
 * Convert styled button definitions to GramJS TL markup (with colors + copy buttons)
 * Requires patched GramJS TL schema (scripts/patch-gramjs.sh)
 */
export function toTLMarkup(buttons: StyledButtonDef[][]): Api.ReplyInlineMarkup {
  const ApiAny = Api as any;
  return new Api.ReplyInlineMarkup({
    rows: buttons
      .filter((row) => row.length > 0)
      .map(
        (row) =>
          new Api.KeyboardButtonRow({
            buttons: row.map((btn) => {
              // Copy button: native click-to-clipboard (no callback needed)
              if (btn.copyText) {
                return new ApiAny.KeyboardButtonCopy({
                  text: btn.text,
                  copyText: btn.copyText,
                });
              }

              // Callback button: with optional color style
              const style = btn.style
                ? new ApiAny.KeyboardButtonStyle({
                    bgSuccess: btn.style === "success",
                    bgDanger: btn.style === "danger",
                    bgPrimary: btn.style === "primary",
                  })
                : undefined;
              return new ApiAny.KeyboardButtonCallback({
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
