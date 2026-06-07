import { isString } from './is-string.ts';

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Checks whether a value is a decimal-shaped string.
 * Accepts optional sign, integer or fractional digits, optional exponent.
 * Hex/binary/octal, whitespace, and `Infinity` are rejected.
 *
 * @example
 * ```ts
 * isDecimalString('1.5')      // -> true
 * isDecimalString('-1.5e3')   // -> true
 * isDecimalString('+5')       // -> true
 * isDecimalString('0x10')     // -> false
 * isDecimalString('Infinity') // -> false
 * isDecimalString(1.5)        // -> false
 * ```
 */
export function isDecimalString(value: unknown): value is string {
  return isString(value) && DECIMAL.test(value);
}
