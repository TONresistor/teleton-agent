import { randomBytes } from "crypto";
import { type BigInteger } from "big-integer";
import { returnBigInt } from "telegram/Helpers.js";

/** Convert native bigint or number to BigInteger for GramJS TL long fields */
export function toLong(value: bigint | number): BigInteger {
  return returnBigInt(String(value));
}

/** Generate cryptographically random BigInteger for randomId / poll ID fields */
export function randomLong(): BigInteger {
  return toLong(randomBytes(8).readBigUInt64BE());
}
