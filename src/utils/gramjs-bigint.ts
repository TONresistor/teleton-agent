import { randomBytes } from "crypto";
import type { BigInteger } from "big-integer";


/** Convert number to bigint for GramJS TL long fields */
export function toLong(value: bigint | number): BigInteger {
  return BigInt(value) as unknown as BigInteger;
}

/** Generate cryptographically random bigint for randomId / poll ID fields */
export function randomLong(): BigInteger {
  return toLong(randomBytes(8).readBigUInt64BE()) as unknown as BigInteger;
}
