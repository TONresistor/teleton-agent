/**
 * Split a `prefix:rest` string on its first colon.
 * Returns null if there is no colon, or the colon is the first character
 * (i.e. there is no non-empty prefix). The `rest` may itself contain colons.
 *
 * Shared routing primitive: the inline-router uses this to peel a plugin prefix
 * off inline queries / callback data / chosen-result ids before dispatch.
 */
export function splitPrefix(raw: string): { prefix: string; rest: string } | null {
  const colonIdx = raw.indexOf(":");
  if (colonIdx <= 0) return null;
  return { prefix: raw.slice(0, colonIdx), rest: raw.slice(colonIdx + 1) };
}
