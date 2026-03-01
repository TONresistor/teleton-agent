import { randomBytes } from "crypto";

/**
 * Convert native bigint, number, or string to bigint for GramJS TL long fields.
 * Uses native BigInt — avoids big-integer lib dual-copy issues with bundlers.
 *
 * Return type is `any` because GramJS typings expect big-integer's BigInteger
 * but the runtime accepts native bigint just fine (see api.js compareType).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLong(value: bigint | number | string): any {
  return typeof value === "bigint" ? value : BigInt(value);
}

/** Generate cryptographically random bigint for randomId / poll ID fields */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function randomLong(): any {
  return randomBytes(8).readBigUInt64BE();
}
