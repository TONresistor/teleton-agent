/** Pure JSON projection. The full result is persisted by the caller before reduction. */
interface SerializableToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  execution?: unknown;
}

export function truncateToolResult(result: SerializableToolResult, maxSize: number): string {
  const resultText = serializeToolResult(result);
  if (resultText.length <= maxSize) return resultText;
  const data =
    result.data && typeof result.data === "object"
      ? (result.data as Record<string, unknown>)
      : undefined;
  const receipt = {
    success: result.success,
    ...(result.execution !== undefined ? { execution: result.execution } : {}),
    ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    data: {
      _truncated: true,
      _originalSize: resultText.length,
      _message: "Full data truncated. Read the full artifact with tool_result_read.",
      ...(data?.outcome !== undefined ? { outcome: data.outcome } : {}),
      ...(data?.retryable !== undefined ? { retryable: data.retryable } : {}),
      ...(data?._artifact ? { _artifact: data._artifact } : {}),
    },
  };
  // The projection is bounded even for huge nested objects or summary fields.
  // Execution receipts are mandatory and must never be silently discarded.
  const base = serializeToolResult(receipt);
  const summary = data?.summary ?? data?.message;
  if (typeof summary !== "string") return base;
  let length = Math.min(summary.length, Math.max(0, maxSize - base.length - 32));
  while (length > 0) {
    const candidate = serializeToolResult({
      ...receipt,
      data: { ...receipt.data, summary: summary.slice(0, length) },
    });
    if (candidate.length <= maxSize) return candidate;
    length = Math.floor(length / 2);
  }
  return base;
}

export function serializeToolResult(result: SerializableToolResult): string {
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
