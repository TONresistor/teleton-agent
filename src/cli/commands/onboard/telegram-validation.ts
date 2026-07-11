import { fetchWithTimeout } from "../../../utils/fetch.js";

/** Shared bot-token format (id:hash). */
export const BOT_TOKEN_REGEX = /^[0-9]+:[A-Za-z0-9_-]+$/;

export function validateBotTokenFormat(value: string): true | string {
  if (!value) return "Bot token is required";
  if (!BOT_TOKEN_REGEX.test(value)) return "Invalid format (expected 123456:ABC...)";
  return true;
}

/** Verify a bot token with Telegram and return the bot username when available. */
export async function validateAndFetchBot(
  token: string
): Promise<{ ok: boolean; username?: string; networkError?: boolean }> {
  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();
    if (!data.ok) return { ok: false };
    return { ok: true, username: data.result.username };
  } catch {
    return { ok: false, networkError: true };
  }
}
