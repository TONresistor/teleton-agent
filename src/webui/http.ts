import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getErrorMessage, getGramJSErrorMessage } from "../utils/errors.js";
import type { APIResponse } from "./contracts.js";

/** Emit the canonical WebUI error envelope. */
export function apiError(context: Context, error: unknown, status: ContentfulStatusCode = 500) {
  const message = typeof error === "string" ? error : getErrorMessage(error);
  return context.json<APIResponse<never>>({ success: false, error: message }, status);
}

/** Normalize GramJS authentication failures, including FLOOD_WAIT retry hints. */
export function telegramAuthError(context: Context, error: unknown) {
  const candidate = error as { seconds?: unknown; message?: unknown } | null;
  if (typeof candidate?.seconds === "number" && candidate.seconds > 0) {
    return apiError(context, `Rate limited. Please wait ${candidate.seconds} seconds.`, 429);
  }

  const message =
    getGramJSErrorMessage(error) ||
    (typeof candidate?.message === "string" ? candidate.message : getErrorMessage(error));
  return apiError(context, message, 500);
}
