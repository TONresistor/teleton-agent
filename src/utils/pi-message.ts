import type { Message, TextContent, ToolCall } from "@earendil-works/pi-ai";

/**
 * Neutral, pure primitives for reading pi-ai `Message` content. Shared by the
 * agent (runtime-utils) and memory (ai-summarization, compaction) layers so that
 * message-content access and envelope parsing live in one place. Caller-specific
 * formatting (prefixes, placeholder labels, truncation lengths) stays local.
 */

/**
 * Concatenate the textual content of a message into a single string.
 * - user: returns string content as-is, or joins the text blocks of array content.
 * - assistant: joins its text blocks with newlines.
 * - other roles: "".
 */
export function extractText(msg: Message): string {
  if (msg.role === "user") {
    if (typeof msg.content === "string") return msg.content;
    return msg.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  if (msg.role === "assistant") {
    return msg.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/** Names of the tool calls in an assistant message, in order. Empty for other roles. */
export function extractToolNames(msg: Message): string[] {
  if (msg.role !== "assistant") return [];
  return msg.content.filter((b): b is ToolCall => b.type === "toolCall").map((b) => b.name);
}

/**
 * Strip a leading envelope prefix such as "[2026-01-01 user] " by returning the
 * text after the first "] ". Returns the input unchanged when no envelope is present.
 */
export function stripEnvelopePrefix(content: string): string {
  const match = content.match(/\] (.+)/s);
  return match ? match[1] : content;
}

/** Truncate to `n` characters, appending "..." only when the string was longer. */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + "..." : s;
}
