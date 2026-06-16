import { coerceToBigInt } from '../coerce/coerce-to-bigint.ts';
import { isBigInt } from '../is/is-bigint.ts';
import { isBoolean } from '../is/is-boolean.ts';

/**
 * Parses a value as a `bigint`.
 * Accepts bigints, safe integers, and integer-shaped strings (sign optional, no leading zeros).
 * Strings over 1024 chars are rejected.
 * Throws on decimals, unsafe-int numbers, booleans, and every other input.
 *
 * @example
 * ```ts
 * parseBigInt(42n)   // -> 42n
 * parseBigInt(42)    // -> 42n
 * parseBigInt('123') // -> 123n
 * parseBigInt('1.5') // throws
 * parseBigInt('007') // throws
 * parseBigInt(1.5)   // throws
 * parseBigInt(true)  // throws
 * ```
 */
export function parseBigInt(raw: unknown): bigint {
  if (isBoolean(raw)) throw new Error(`Expected bigint, got: ${String(raw)}`);
  const b = coerceToBigInt(raw);
  if (isBigInt(b)) return b;
  throw new Error(`Expected bigint, got: ${String(raw)}`);
}
