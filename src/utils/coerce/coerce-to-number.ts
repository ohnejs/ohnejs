import { isBoolean } from '../is/is-boolean.ts';
import { isDecimalString } from '../is/is-decimal-string.ts';
import { isRealNumber } from '../is/is-real-number.ts';

/**
 * Coerces decimal-shaped strings and booleans to numbers.
 * Unlike `coerceToInteger`, decimals are kept.
 * Hex/binary/octal/whitespace/`Infinity` strings pass through.
 *
 * @example
 * ```ts
 * coerceToNumber('1.5')      // -> 1.5
 * coerceToNumber(true)       // -> 1
 * coerceToNumber('0x10')     // -> '0x10'
 * coerceToNumber('Infinity') // -> 'Infinity'
 * coerceToNumber(null)       // -> null
 * ```
 */
export function coerceToNumber<T>(value: T): T | number {
  if (isDecimalString(value)) {
    const parsed = Number(value);
    if (isRealNumber(parsed)) return parsed;
    return value;
  }
  if (isBoolean(value)) return value ? 1 : 0;
  return value;
}
