import { randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie name for HttpOnly session */
export const COOKIE_NAME = "teleton_session";

/** Max age for session cookie (7 days in seconds) */
export const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/** Generate a 32-byte base64url token for API auth */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Timing-safe token comparison to prevent side-channel attacks.
 * Returns false for empty or mismatched-length tokens.
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
