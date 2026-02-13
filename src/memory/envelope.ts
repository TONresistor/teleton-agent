/**
 * Message envelope formatting (OpenClaw-style)
 * Formats messages with rich metadata: channel, sender, elapsed time, timestamp
 */

import { sanitizeForPrompt } from "../utils/sanitize.js";

export interface EnvelopeParams {
  channel: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  timestamp: number;
  previousTimestamp?: number;
  body: string;
  isGroup: boolean;
  chatType?: "direct" | "group" | "channel";
  // Media info
  hasMedia?: boolean;
  mediaType?: string;
  messageId?: number; // For media download reference
}

/**
 * Format elapsed time between messages
 */
function formatElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "";
  }

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format timestamp in local timezone
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  // Get timezone abbreviation
  const tz = Intl.DateTimeFormat("en", {
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  return `${yyyy}-${mm}-${dd} ${hh}:${min}${tz ? ` ${tz}` : ""}`;
}

/**
 * Build sender label for envelope
 * In groups, show "Name (@username)" if both available
 */
function buildSenderLabel(params: EnvelopeParams): string {
  const name = params.senderName ? sanitizeForPrompt(params.senderName) : undefined;
  const username = params.senderUsername
    ? `@${sanitizeForPrompt(params.senderUsername)}`
    : undefined;
  const idTag = params.senderId ? `id:${params.senderId}` : undefined;

  // Always include senderId for unambiguous identification
  // Format: "Name (@user, id:123)" | "Name (id:123)" | "@user (id:123)" | "id:123" | "unknown"
  const primary = name || username;
  const meta = [username, idTag].filter((v) => v && v !== primary);

  if (primary) {
    return meta.length > 0 ? `${primary} (${meta.join(", ")})` : primary;
  }

  return idTag || "unknown";
}

/**
 * Format message envelope OpenClaw-style
 * Example: [Telegram Alice +5m 2024-01-15 14:30 CET] Hello!
 */
export function formatMessageEnvelope(params: EnvelopeParams): string {
  const parts: string[] = [params.channel];

  // Add sender (for groups) or from label (for DMs)
  const senderLabel = buildSenderLabel(params);
  if (params.isGroup) {
    // Groups: add sender at message level, not in envelope
    // Envelope just has channel
  } else {
    // DMs: add sender in envelope
    parts.push(senderLabel);
  }

  // Add elapsed time if we have previous timestamp
  if (params.previousTimestamp) {
    const elapsed = formatElapsed(params.timestamp - params.previousTimestamp);
    if (elapsed) {
      parts.push(`+${elapsed}`);
    }
  }

  // Add formatted timestamp
  const ts = formatTimestamp(params.timestamp);
  parts.push(ts);

  // Build envelope header
  const header = `[${parts.join(" ")}]`;

  // Strip boundary tags from user content to prevent tag injection, then wrap
  const safeBody = params.body.replace(/<\/?user_message>/gi, "");
  let body = params.isGroup
    ? `${senderLabel}: <user_message>${safeBody}</user_message>`
    : `<user_message>${safeBody}</user_message>`;

  // Add media indicator if present (with message ID for easy download)
  if (params.hasMedia && params.mediaType) {
    const mediaEmoji =
      {
        photo: "📷",
        video: "🎬",
        audio: "🎵",
        voice: "🎤",
        document: "📎",
        sticker: "🎨",
      }[params.mediaType] || "📎";
    const msgIdHint = params.messageId ? ` msg_id=${params.messageId}` : "";
    body = `[${mediaEmoji} ${params.mediaType}${msgIdHint}] ${body}`;
  }

  return `${header} ${body}`;
}

/**
 * Format message envelope with simplified format
 * For when full OpenClaw style is too verbose
 */
export function formatMessageEnvelopeSimple(params: {
  senderId?: string;
  senderName?: string;
  body: string;
  isGroup: boolean;
}): string {
  if (!params.isGroup) {
    return params.body;
  }

  const sender = params.senderName || (params.senderId ? `user:${params.senderId}` : "unknown");
  return `${sender}: ${params.body}`;
}
