import { randomBytes } from "crypto";
import { fromNano } from "@ton/core";
import type { Api } from "telegram";

export function readStarsAmount(
  value: Api.TypeStarsAmount
):
  { currency: "Stars" | "TON"; amount: string; displayAmount: string; isTon: boolean } | undefined {
  const amount = value.amount?.toString();
  if (amount === undefined) return undefined;

  if (value.className === "StarsTonAmount") {
    return { currency: "TON", amount, displayAmount: fromNano(amount), isTon: true };
  }
  if (value.className === "StarsAmount") {
    // Both currencies use 9 decimal places. Keep large and fractional prices exact.
    const nanostars = BigInt(amount) * 1_000_000_000n + BigInt(value.nanos);
    return { currency: "Stars", amount, displayAmount: fromNano(nanostars), isTon: false };
  }
  return undefined;
}

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
