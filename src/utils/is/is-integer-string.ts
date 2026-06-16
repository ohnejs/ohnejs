import { isString } from './is-string.ts';

const INTEGER = /^[+-]?(?:0|[1-9]\d*)$/;

/**
 * Checks whether a value is an integer-shaped string.
 * Accepts an optional sign and digits with no leading zeros.
 * Decimals, exponents, hex/binary/octal, leading zeros, and whitespace are rejected.
 *
 * @example
 * ```ts
 * isIntegerString('0')      // -> true
 * isIntegerString('-7')     // -> true
 * isIntegerString('+5')     // -> true
 * isIntegerString('1.5')    // -> false
 * isIntegerString('1e3')    // -> false
 * isIntegerString('007')    // -> false
 * isIntegerString('0x10')   // -> false
 * isIntegerString(42)       // -> false
 * ```
 */
export function isIntegerString(value: unknown): value is string {
  return isString(value) && INTEGER.test(value);
}
