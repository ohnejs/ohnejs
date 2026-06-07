import { isBoolean } from '../is/is-boolean.ts';
import { isDecimalString } from '../is/is-decimal-string.ts';
import { isInteger } from '../is/is-integer.ts';
import { isRealNumber } from '../is/is-real-number.ts';

/**
 * Coerces decimal-shaped strings and booleans to safe integers.
 * Truncation is toward zero.
 * Hex/octal/binary, whitespace, and unsafe results pass through.
 *
 * @example
 * ```ts
 * coerceToInteger('123')  // -> 123
 * coerceToInteger('1.9')  // -> 1
 * coerceToInteger('-1.9') // -> -1
 * coerceToInteger('1e20') // -> '1e20'
 * coerceToInteger('0x10') // -> '0x10'
 * coerceToInteger(true)   // -> 1
 * coerceToInteger(null)   // -> null
 * ```
 */
export function coerceToInteger<T>(value: T): T | number {
  if (isDecimalString(value)) {
    const parsed = Number(value);
    if (isRealNumber(parsed)) {
      const truncated = Math.trunc(parsed);
      if (isInteger(truncated)) return truncated;
    }
    return value;
  }
  if (isBoolean(value)) return value ? 1 : 0;
  return value;
}
