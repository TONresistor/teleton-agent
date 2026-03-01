import { sanitizeForPrompt, sanitizeForContext } from "../utils/sanitize.js";

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
  replyContext?: {
    senderName?: string;
    text: string;
    isAgent?: boolean;
  };
}

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

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  const tz = Intl.DateTimeFormat("en", {
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  return `${yyyy}-${mm}-${dd} ${hh}:${min}${tz ? ` ${tz}` : ""}`;
}

/**
 * Build sender label for envelope.
 * Format: "Name (@username, id:123)" or variations with available fields.
 */
function buildSenderLabel(params: EnvelopeParams): string {
  const name = params.senderName ? sanitizeForPrompt(params.senderName) : undefined;
  const username = params.senderUsername
    ? `@${sanitizeForPrompt(params.senderUsername)}`
    : undefined;
  const idTag = params.senderId ? `id:${params.senderId}` : undefined;

  const primary = name || username;
  const meta = [username, idTag].filter((v) => v && v !== primary);

  if (primary) {
    return meta.length > 0 ? `${primary} (${meta.join(", ")})` : primary;
  }

  return idTag || "unknown";
}

export function formatMessageEnvelope(params: EnvelopeParams): string {
  const parts: string[] = [params.channel];

  const senderLabel = buildSenderLabel(params);
  if (!params.isGroup) {
    parts.push(senderLabel);
  }

  if (params.previousTimestamp) {
    const elapsed = formatElapsed(params.timestamp - params.previousTimestamp);
    if (elapsed) {
      parts.push(`+${elapsed}`);
    }
  }

  const ts = formatTimestamp(params.timestamp);
  parts.push(ts);

  const header = `[${parts.join(" ")}]`;

  const safeBody = sanitizeForContext(params.body.replace(/<\/?user_message>/gi, ""));
  let body = params.isGroup
    ? `${senderLabel}: <user_message>${safeBody}</user_message>`
    : `<user_message>${safeBody}</user_message>`;

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

  if (params.replyContext) {
    const sender = params.replyContext.isAgent
      ? "agent"
      : sanitizeForPrompt(params.replyContext.senderName ?? "unknown");
    let quotedText = sanitizeForContext(params.replyContext.text);
    if (quotedText.length > 200) quotedText = quotedText.slice(0, 200) + "...";
    return `${header}\n[↩ reply to ${sender}: "${quotedText}"]\n${body}`;
  }
  return `${header} ${body}`;
}

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
