import { isIntegerString } from '../is/is-integer-string.ts';
import { isPositiveInteger } from '../is/is-positive-integer.ts';

/**
 * Parses a value as a positive integer (`> 0`).
 * Accepts positive safe integers and positive-integer-shaped strings (sign optional, no leading zeros).
 * Throws on zero, negatives, decimals, exponents, leading zeros, booleans, and unsafe-range values.
 *
 * @example
 * ```ts
 * parsePositiveInteger(42)    // -> 42
 * parsePositiveInteger('7')   // -> 7
 * parsePositiveInteger(0)     // throws
 * parsePositiveInteger(-1)    // throws
 * parsePositiveInteger('1.9') // throws
 * parsePositiveInteger(true)  // throws
 * ```
 */
export function parsePositiveInteger(raw: unknown): number {
  if (isPositiveInteger(raw)) return raw;
  if (isIntegerString(raw)) {
    const n = Number(raw);
    if (isPositiveInteger(n)) return n;
  }
  throw new Error(`Expected positive integer, got: ${String(raw)}`);
}
