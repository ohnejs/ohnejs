import { isIntegerString } from '../is/is-integer-string.ts';
import { isInteger } from '../is/is-integer.ts';

/**
 * Parses a value as a safe integer.
 * Accepts safe integers and integer-shaped strings (sign optional, no leading zeros).
 * Throws on decimals, exponents, leading zeros, booleans, and values outside the safe range.
 *
 * @example
 * ```ts
 * parseInteger(42)     // -> 42
 * parseInteger('-7')   // -> -7
 * parseInteger('1.9')  // throws
 * parseInteger('007')  // throws
 * parseInteger('1e3')  // throws
 * parseInteger(true)   // throws
 * parseInteger('1e20') // throws (out of safe range)
 * ```
 */
export function parseInteger(raw: unknown): number {
  if (isInteger(raw)) return raw;
  if (isIntegerString(raw)) {
    const n = Number(raw);
    if (isInteger(n)) return n;
    throw new Error(`Integer out of safe range: ${raw}`);
  }
  throw new Error(`Expected integer, got: ${String(raw)}`);
}
