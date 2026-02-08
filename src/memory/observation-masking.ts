import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import type { ToolRegistry } from "../agent/tools/registry.js";

/**
 * Configuration for observation masking
 */
export interface MaskingConfig {
  keepRecentCount: number; // Keep the N most recent tool results complete
  keepErrorResults: boolean; // Always keep error results complete
}

/**
 * Default masking configuration
 */
export const DEFAULT_MASKING_CONFIG: MaskingConfig = {
  keepRecentCount: 10,
  keepErrorResults: true,
};

/**
 * Mask old tool results to reduce context size
 *
 * This function replaces the content of old tool results with a compact summary,
 * preserving only the tool name and status. Recent results and errors are kept complete.
 *
 * Typical savings: ~90% reduction per masked tool_result (50KB → 50 bytes)
 *
 * @param messages - Array of conversation messages
 * @param config - Masking configuration
 * @returns New array with old tool results masked
 */
export function maskOldToolResults(
  messages: Message[],
  config: MaskingConfig = DEFAULT_MASKING_CONFIG,
  toolRegistry?: ToolRegistry
): Message[] {
  // Identify all tool_result messages with their indices
  const toolResults = messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "toolResult");

  // If we have fewer than keepRecentCount, nothing to mask
  if (toolResults.length <= config.keepRecentCount) {
    return messages;
  }

  // Determine which tool results to mask (all except the most recent N)
  const toMask = toolResults.slice(0, -config.keepRecentCount);

  // Create a copy of messages array
  const result = [...messages];

  for (const { msg, index } of toMask) {
    const toolMsg = msg as ToolResultMessage;

    // Skip errors if configured to keep them
    if (config.keepErrorResults && toolMsg.isError) {
      continue;
    }

    // NEVER mask data-bearing tools (balances, holdings, etc.)
    if (toolRegistry) {
      const category = toolRegistry.getToolCategory(toolMsg.toolName);
      if (category === "data-bearing") {
        continue;
      }
    }

    // Extract summary/message from tool result if available
    let summaryText = "";
    try {
      const content = toolMsg.content as Array<{ type: string; text?: string }>;
      const textBlock = content.find((c) => c.type === "text");
      if (textBlock?.text) {
        const parsed = JSON.parse(textBlock.text);
        if (parsed.data?.summary) {
          summaryText = ` - ${parsed.data.summary}`;
        } else if (parsed.data?.message) {
          summaryText = ` - ${parsed.data.message}`;
        }
      }
    } catch {
      // Ignore JSON parse errors - just use basic placeholder
    }

    // Replace with masked version (with summary/message preserved)
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

  return result;
}

/**
 * Calculate approximate token savings from masking
 *
 * @param originalMessages - Original messages
 * @param maskedMessages - Masked messages
 * @returns Estimated token savings
 */
export function calculateMaskingSavings(
  originalMessages: Message[],
  maskedMessages: Message[]
): { originalChars: number; maskedChars: number; savings: number } {
  const countChars = (messages: Message[]): number => {
    let total = 0;
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        const content = msg.content as Array<{ type: string; text?: string }>;
        for (const block of content) {
          if (block.type === "text" && block.text) {
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
