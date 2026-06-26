/**
 * Inline-message MTProto transport.
 *
 * Encapsulates every GramJS (MTProto) operation the bot performs on inline
 * messages — answering inline queries with styled buttons and editing inline
 * messages — so the plugin SDK stays free of transport plumbing.
 *
 * Depends only on a GramJSBotClient and the pure formatting helpers; it has no
 * knowledge of business logic. Each higher-level caller keeps its own
 * Grammy (Bot API) fallback.
 */

import { Api } from "telegram";
import type { GramJSBotClient } from "../gramjs-bot.js";
import {
  toTLMarkup,
  hasStyledButtons,
  parseHtml,
  stripCustomEmoji,
  type StyledButtonDef,
} from "../../sdk/formatting.js";
import { getGramJSErrorMessage } from "../../utils/errors.js";

/**
 * Edit an inline message via GramJS MTProto (raw — does NOT swallow errors).
 *
 * The GramJS trunk shared by every inline-edit site: parseHtml → toTLMarkup →
 * editInlineMessageByStringId. Throws on any GramJS error, including
 * MESSAGE_NOT_MODIFIED, so callers can decide how to handle each case.
 */
async function editInlineRaw(params: {
  gramjsBot: GramJSBotClient;
  inlineMessageId: string;
  html: string;
  buttons?: StyledButtonDef[][];
}): Promise<void> {
  const { gramjsBot, inlineMessageId, html, buttons } = params;

  const { text: plainText, entities } = parseHtml(html);
  const markup = buttons && hasStyledButtons(buttons) ? toTLMarkup(buttons) : undefined;

  await gramjsBot.editInlineMessageByStringId({
    inlineMessageId,
    text: plainText,
    entities: entities.length > 0 ? entities : undefined,
    replyMarkup: markup,
  });
}

/**
 * Edit an inline message via GramJS MTProto (styled buttons, custom emoji).
 *
 * @returns `true` if the edit succeeded (or was a no-op because the content was
 *   unchanged — MESSAGE_NOT_MODIFIED is swallowed). Throws on any other GramJS
 *   error so callers can run their own Grammy fallback.
 */
export async function editInlineViaGramJS(params: {
  gramjsBot: GramJSBotClient;
  inlineMessageId: string;
  html: string;
  buttons?: StyledButtonDef[][];
}): Promise<boolean> {
  try {
    await editInlineRaw(params);
    return true;
  } catch (error: unknown) {
    if (getGramJSErrorMessage(error) === "MESSAGE_NOT_MODIFIED") return true;
    throw error;
  }
}

/**
 * Edit an inline message via GramJS without swallowing MESSAGE_NOT_MODIFIED.
 *
 * Used by chosen_inline_result, where any failure (including a no-op edit on a
 * freshly created message) must surface to the caller's Grammy fallback path.
 */
export async function editInlineViaGramJSStrict(params: {
  gramjsBot: GramJSBotClient;
  inlineMessageId: string;
  html: string;
  buttons?: StyledButtonDef[][];
}): Promise<void> {
  await editInlineRaw(params);
}

/**
 * Answer an inline query with a single styled article result via GramJS MTProto.
 *
 * Custom emojis are stripped (SetInlineBotResults does not support them). The
 * caller supplies the already-built title/description and the styled message body.
 */
export async function answerInlineQueryStyled(params: {
  gramjsBot: GramJSBotClient;
  queryId: string;
  resultId: string;
  title: string;
  description: string;
  html: string;
  buttons: StyledButtonDef[][];
}): Promise<void> {
  const { gramjsBot, queryId, resultId, title, description, html, buttons } = params;

  const strippedHtml = stripCustomEmoji(html);
  const { text: plainText, entities } = parseHtml(strippedHtml);
  const markup = hasStyledButtons(buttons) ? toTLMarkup(buttons) : undefined;

  await gramjsBot.answerInlineQuery({
    queryId,
    results: [
      new Api.InputBotInlineResult({
        id: resultId,
        type: "article",
        title,
        description,
        sendMessage: new Api.InputBotInlineMessageText({
          message: plainText,
          entities: entities.length > 0 ? entities : undefined,
          noWebpage: true,
          replyMarkup: markup,
        }),
      }),
    ],
    cacheTime: 0,
  });
}
