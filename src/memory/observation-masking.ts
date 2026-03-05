import type { Message, ToolResultMessage, UserMessage, TextContent } from "@mariozechner/pi-ai";
import type { ToolRegistry } from "../agent/tools/registry.js";
import {
  MASKING_KEEP_RECENT_COUNT,
  RESULT_TRUNCATION_THRESHOLD,
  RESULT_TRUNCATION_KEEP_CHARS,
} from "../constants/limits.js";

export interface MaskingConfig {
  keepRecentCount: number; // Keep the N most recent tool results complete
  keepErrorResults: boolean; // Always keep error results complete
  truncationThreshold: number; // Truncate recent results exceeding this char count
  truncationKeepChars: number; // Keep this many chars when truncating
}

export const DEFAULT_MASKING_CONFIG: MaskingConfig = {
  keepRecentCount: MASKING_KEEP_RECENT_COUNT,
  keepErrorResults: true,
  truncationThreshold: RESULT_TRUNCATION_THRESHOLD,
  truncationKeepChars: RESULT_TRUNCATION_KEEP_CHARS,
};

export interface MaskingOptions {
  config?: MaskingConfig;
  toolRegistry?: ToolRegistry;
  currentIterationStartIndex?: number;
}

/** Detect Cocoon-style tool results (UserMessage with `<tool_response>` CDATA). */
const isCocoonToolResult = (msg: Message): boolean =>
  msg.role === "user" &&
  Array.isArray(msg.content) &&
  msg.content.some((c) => c.type === "text" && c.text.includes("<tool_response>"));

/** Check if a tool result should be exempt from masking/truncation. */
function isExempt(
  toolMsg: ToolResultMessage,
  config: MaskingConfig,
  toolRegistry: ToolRegistry | undefined
): boolean {
  if (config.keepErrorResults && toolMsg.isError) return true;
  if (toolRegistry && toolRegistry.getToolCategory(toolMsg.toolName) === "data-bearing")
    return true;
  return false;
}

/**
 * Extract a compact summary from a tool result JSON string.
 * Returns the summary/message field if present, else first N chars.
 */
function truncateToolResult(text: string, keepChars: number): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed.data?.summary) {
      return JSON.stringify({
        success: parsed.success,
        data: { summary: parsed.data.summary, _truncated: true },
      });
    }
    if (parsed.data?.message) {
      return JSON.stringify({
        success: parsed.success,
        data: { summary: parsed.data.message, _truncated: true },
      });
    }
  } catch {
    // Not JSON — truncate raw
  }
  return text.slice(0, keepChars) + `\n...[truncated, original: ${text.length} chars]`;
}

/**
 * Mask old tool results to reduce context size.
 * - Results older than keepRecentCount: fully masked to "[Tool: name - OK]"
 * - Recent results from previous iterations exceeding truncationThreshold: truncated
 * - Current iteration results: kept intact
 */
export function maskOldToolResults(messages: Message[], options?: MaskingOptions): Message[] {
  const config = options?.config ?? DEFAULT_MASKING_CONFIG;
  const toolRegistry = options?.toolRegistry;
  const iterStart = options?.currentIterationStartIndex;

  const toolResults = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "toolResult" || isCocoonToolResult(msg));

  // Quick exit: nothing to mask or truncate
  const needsMasking = toolResults.length > config.keepRecentCount;
  const needsTruncation = iterStart !== undefined && config.truncationThreshold > 0;
  if (!needsMasking && !needsTruncation) {
    return messages;
  }

  const result = [...messages];

  // Phase 1: Full masking of old results (beyond keepRecentCount)
  if (needsMasking) {
    const toMask = toolResults.slice(0, -config.keepRecentCount);

    for (const { msg, index } of toMask) {
      if (isCocoonToolResult(msg)) {
        result[index] = {
          ...msg,
          content: [{ type: "text" as const, text: "[Tool response masked]" }],
        } as UserMessage;
        continue;
      }

      const toolMsg = msg as ToolResultMessage;
      if (isExempt(toolMsg, config, toolRegistry)) continue;

      let summaryText = "";
      try {
        const textBlock = toolMsg.content.find((c): c is TextContent => c.type === "text");
        if (textBlock) {
          const parsed = JSON.parse(textBlock.text);
          if (parsed.data?.summary) {
            summaryText = ` - ${parsed.data.summary}`;
          } else if (parsed.data?.message) {
            summaryText = ` - ${parsed.data.message}`;
          }
        }
      } catch {}

      result[index] = {
        ...toolMsg,
        content: [
          {
            type: "text",
            text: `[Tool: ${toolMsg.toolName} - ${toolMsg.isError ? "ERROR" : "OK"}${summaryText}]`,
          },
        ],
      };
    }
  }

  // Phase 2: Truncate oversized recent results from previous iterations
  if (needsTruncation) {
    const recentResults = needsMasking ? toolResults.slice(-config.keepRecentCount) : toolResults;

    for (const { msg, index } of recentResults) {
      // Never truncate results from the current iteration
      if (index >= iterStart) continue;

      if (isCocoonToolResult(msg)) {
        const userMsg = msg as UserMessage;
        if (!Array.isArray(userMsg.content)) continue;
        const textBlock = userMsg.content.find((c): c is TextContent => c.type === "text");
        if (textBlock && textBlock.text.length > config.truncationThreshold) {
          result[index] = {
            ...userMsg,
            content: [
              {
                type: "text" as const,
                text: truncateToolResult(textBlock.text, config.truncationKeepChars),
              },
            ],
          } as UserMessage;
        }
        continue;
      }

      const toolMsg = msg as ToolResultMessage;
      if (isExempt(toolMsg, config, toolRegistry)) continue;

      const textBlock = toolMsg.content.find((c): c is TextContent => c.type === "text");
      if (!textBlock || textBlock.text.length <= config.truncationThreshold) continue;

      result[index] = {
        ...toolMsg,
        content: [
          {
            type: "text",
            text: truncateToolResult(textBlock.text, config.truncationKeepChars),
          },
        ],
      };
    }
  }

  return result;
}

export function calculateMaskingSavings(
  originalMessages: Message[],
  maskedMessages: Message[]
): { originalChars: number; maskedChars: number; savings: number } {
  const countChars = (messages: Message[]): number => {
    let total = 0;
    for (const msg of messages) {
      if (msg.role === "toolResult" || isCocoonToolResult(msg)) {
        for (const block of msg.content) {
          if (typeof block !== "string" && block.type === "text") {
            total += block.text.length;
          }
        }
      }
    }
    return total;
  };

  const originalChars = countChars(originalMessages);
  const maskedChars = countChars(maskedMessages);

  return {
    originalChars,
    maskedChars,
    savings: originalChars - maskedChars,
  };
}
