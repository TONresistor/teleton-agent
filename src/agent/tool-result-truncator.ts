/**
 * Truncates oversized tool results into a valid JSON summary.
 * Pure function — no side effects, no logging.
 */
export function truncateToolResult(
  result: { success: boolean; data?: unknown; error?: string },
  maxSize: number
): string {
  const resultText = serializeToolResult(result);
  if (resultText.length <= maxSize) return resultText;

  const data = result.data as Record<string, unknown> | undefined;
  if (data?.summary || data?.message) {
    return JSON.stringify({
      success: result.success,
      data: {
        summary: data.summary || data.message,
        _truncated: true,
        _originalSize: resultText.length,
        _message: "Full data truncated. Use limit parameter for smaller results.",
      },
    });
  }

  // Build a valid JSON summary instead of raw-slicing (which breaks JSON)
  const summarized: Record<string, unknown> = {
    _truncated: true,
    _originalSize: resultText.length,
    _message: "Full data truncated. Use limit parameter for smaller results.",
  };
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        summarized[key] = `[${value.length} items]`;
      } else if (typeof value === "string" && value.length > 500) {
        summarized[key] = value.slice(0, 500) + "...[truncated]";
      } else {
        summarized[key] = value;
      }
    }
  }
  return JSON.stringify({ success: result.success, data: summarized });
}

export function serializeToolResult(result: {
  success: boolean;
  data?: unknown;
  error?: string;
}): string {
  return JSON.stringify(result, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

export function attachArtifactReference(
  truncatedResult: string,
  artifact: { id: string; sizeBytes: number }
): string {
  const parsed = JSON.parse(truncatedResult) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
  parsed.data = {
    ...(parsed.data ?? {}),
    _artifact: {
      id: artifact.id,
      size_bytes: artifact.sizeBytes,
      read_with: "tool_result_read",
      hint: "Read the full result in pages with tool_result_read.",
    },
  };
  return JSON.stringify(parsed);
}
