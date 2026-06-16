import { isDecimalString } from '../is/is-decimal-string.ts';
import { isRealNumber } from '../is/is-real-number.ts';

/**
 * Parses a value as a finite number.
 * Accepts finite numbers and decimal-shaped strings (sign, fractional digits, exponent).
 * Throws on `NaN`, `Infinity`, hex/binary/octal strings, booleans, and other types.
 *
 * @example
 * ```ts
 * parseNumber(1.5)        // -> 1.5
 * parseNumber('-1.5e3')   // -> -1500
 * parseNumber('1e500')    // throws (out of finite range)
 * parseNumber('Infinity') // throws
 * parseNumber('0x10')     // throws
 * parseNumber(NaN)        // throws
 * parseNumber(true)       // throws
 * ```
 */
export function parseNumber(raw: unknown): number {
  if (isRealNumber(raw)) return raw;
  if (isDecimalString(raw)) {
    const n = Number(raw);
    if (isRealNumber(n)) return n;
    throw new Error(`Number out of finite range: ${raw}`);
  }
  throw new Error(`Expected number, got: ${String(raw)}`);
}
