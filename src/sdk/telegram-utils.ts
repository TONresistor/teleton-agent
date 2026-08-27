import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { isUserBridge } from "../telegram/bridge-guards.js";
import type { Api } from "telegram";
import type { SimpleMessage } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

/**
 * Canonical friendly messages for known Telegram/GramJS error codes. Shared so a
 * single code does not drift into several different wordings across executors.
 */
const TELEGRAM_ERROR_MESSAGES: Record<string, string> = {
  USERNAME_OCCUPIED: "Username is already taken. Please choose another.",
  CHAT_ADMIN_REQUIRED: "You need admin rights to change this channel's username.",
  CHANNELS_ADMIN_PUBLIC_TOO_MUCH:
    "You admin too many public channels. Make some channels private first.",
};

/**
 * Map a Telegram/GramJS error to a failed ToolResult using the shared friendly-
 * message table. Pass `overrides` for codes that need tool-specific (often dynamic)
 * text; unknown codes fall back to the raw error message.
 *
 * Only handles error→failure mapping. Executors that turn a code into a *success*
 * (e.g. USERNAME_NOT_MODIFIED) must keep that branch before calling this.
 */
export function mapTelegramError(
  error: unknown,
  overrides?: Record<string, string>
): { success: false; error: string } {
  const msg = getErrorMessage(error);
  const table = overrides ? { ...TELEGRAM_ERROR_MESSAGES, ...overrides } : TELEGRAM_ERROR_MESSAGES;
  for (const code of Object.keys(table)) {
    if (msg.includes(code)) {
      return { success: false, error: table[code] };
    }
  }
  return { success: false, error: msg };
}

export function requireBridge(bridge: ITelegramBridge): void {
  if (!bridge.isAvailable()) {
    throw new PluginSDKError(
      "Telegram bridge not connected. SDK telegram methods can only be called at runtime (inside tool executors or start()), not during plugin loading.",
      "BRIDGE_NOT_CONNECTED"
    );
  }
}

export function getClient(bridge: ITelegramBridge) {
  if (!isUserBridge(bridge)) {
    throw new Error(
      "This tool requires user mode — it relies on an MTProto capability the Bot API does not provide."
    );
  }
  return bridge.getClient().getClient();
}

/** Canonical public-username rule for channels/groups (5-32 chars, no leading/trailing underscore). */
const CHANNEL_USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

/** Strip a leading "@" from a username. */
export function cleanUsername(input: string): string {
  return input.replace(/^@/, "");
}

/**
 * Validate a channel/group public username against the canonical Telegram rule.
 * Pass `allowEmpty` when an empty value is meaningful (e.g. removing a username).
 */
export function validateChannelUsername(
  input: string,
  options: { allowEmpty?: boolean } = {}
): { ok: true; clean: string } | { ok: false; error: string } {
  const clean = cleanUsername(input);
  const invalid = clean.length === 0 ? !options.allowEmpty : !CHANNEL_USERNAME_REGEX.test(clean);
  if (invalid) {
    return {
      ok: false,
      error:
        "Invalid username format. Must be 5-32 characters, alphanumeric and underscores only, cannot start/end with underscore.",
    };
  }
  return { ok: true, clean };
}

/**
 * Resolve a channel/group entity and narrow it to Api.Channel. Throws a readable
 * Error (caught by the executor's existing catch) when the entity isn't a channel.
 */
export async function resolveChannel(
  bridge: ITelegramBridge,
  channelId: string
): Promise<Api.Channel> {
  const client = getClient(bridge);
  const entity = await client.getEntity(channelId);
  if (entity.className !== "Channel") {
    throw new Error(`Entity is not a channel/group (got ${entity.className})`);
  }
  return entity as Api.Channel;
}

export function toSimpleMessageWithText(msg: Api.Message, text: string): SimpleMessage {
  const fromId = msg.fromId;
  let senderId = 0;
  if (fromId) {
    if ("userId" in fromId) senderId = Number(fromId.userId);
    else if ("channelId" in fromId) senderId = Number(fromId.channelId);
    else if ("chatId" in fromId) senderId = Number(fromId.chatId);
  }
  return {
    id: msg.id,
    text,
    senderId,
    timestamp: new Date(msg.date * 1000),
  };
}

/** Cached dynamic import of telegram Api (needed in files with type-only imports) */
let _Api: typeof Api;
export async function getApi(): Promise<typeof Api> {
  if (!_Api) {
    _Api = (await import("telegram")).Api;
  }
  return _Api;
}

export interface TranscribeResult {
  transcriptionId?: string;
  text: string | null;
  pending: boolean;
  trialRemainsNum?: number;
  trialRemainsUntilDate?: number;
}

const TRANSCRIBE_POLL_INTERVAL_MS = 1500;
const TRANSCRIBE_MAX_POLL_RETRIES = 15;

/**
 * Server-side transcription of a voice/audio message, polling until it completes.
 * Core shared by the telegram_transcribe_audio tool and the auto-transcribe path
 * in the message handler (so the bridge layer no longer imports a tool executor).
 * Throws on Telegram errors (PREMIUM_ACCOUNT_REQUIRED, MSG_ID_INVALID, …).
 */
export async function transcribeAudio(
  bridge: ITelegramBridge,
  chatId: string,
  messageId: number
): Promise<TranscribeResult> {
  const ApiNs = await getApi();
  const client = getClient(bridge);
  const entity = await client.getEntity(chatId);

  let result = await client.invoke(
    new ApiNs.messages.TranscribeAudio({ peer: entity, msgId: messageId })
  );

  let retries = 0;
  while (result.pending && retries < TRANSCRIBE_MAX_POLL_RETRIES) {
    retries++;
    log.debug(`⏳ Transcription pending, polling (${retries}/${TRANSCRIBE_MAX_POLL_RETRIES})...`);
    await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_POLL_INTERVAL_MS));
    try {
      result = await client.invoke(
        new ApiNs.messages.TranscribeAudio({ peer: entity, msgId: messageId })
      );
    } catch (pollError: unknown) {
      // On transient errors (FLOOD_WAIT, network), keep polling
      log.warn(`Transcription poll ${retries} failed: ${getErrorMessage(pollError)}`);
      continue;
    }
  }

  return {
    transcriptionId: result.transcriptionId?.toString(),
    text: result.text ?? null,
    pending: result.pending ?? false,
    ...(result.trialRemainsNum !== undefined && {
      trialRemainsNum: result.trialRemainsNum,
      trialRemainsUntilDate: result.trialRemainsUntilDate,
    }),
  };
}
