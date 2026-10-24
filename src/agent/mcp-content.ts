import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import { sanitizeForContext } from "../utils/sanitize.js";

export interface McpResultPayload {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Keep remote types intact. Resource links are descriptors, never fetched here. */
export function preserveMcpResult(result: McpResultPayload): McpResultPayload {
  return {
    content: structuredClone(result.content ?? []),
    ...(result.structuredContent !== undefined
      ? { structuredContent: structuredClone(result.structuredContent) }
      : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
  };
}

/** Build only modalities understood by the active provider; retain descriptors for others. */
export function projectMcpContent(
  result: McpResultPayload,
  acceptsImages: boolean
): (TextContent | ImageContent)[] {
  return (result.content ?? []).map((raw): TextContent | ImageContent => {
    const block = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (block.type === "text" && typeof block.text === "string") {
      return { type: "text", text: sanitizeForContext(block.text) };
    }
    if (
      block.type === "image" &&
      acceptsImages &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      return { type: "image", data: block.data, mimeType: block.mimeType };
    }
    const descriptor = Object.fromEntries(Object.entries(block).filter(([key]) => key !== "data"));
    return {
      type: "text",
      text: `[MCP ${String(block.type ?? "unknown")} content; original preserved in tool result/artifact] ${sanitizeForContext(JSON.stringify(descriptor, (key, value) => (key === "blob" || key === "data" ? "[binary preserved in artifact]" : value)))}`,
    };
  });
}
