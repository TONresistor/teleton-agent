/** Extract a human-readable message from an unknown catch value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** GramJS errors carry a `.errorMessage`; read it from an unknown catch value. */
export function getGramJSErrorMessage(err: unknown): string | undefined {
  return (err as { errorMessage?: string } | null | undefined)?.errorMessage;
}

/** Structural type guard for HTTP-style errors (axios, ton-client, etc.) */
export function isHttpError(
  err: unknown
): err is { status?: number; response?: { status?: number; data?: unknown } } {
  return typeof err === "object" && err !== null && ("status" in err || "response" in err);
}
