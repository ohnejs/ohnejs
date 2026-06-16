import { isPositiveInteger } from '../is/is-positive-integer.ts';
import { coerceToInteger } from './coerce-to-integer.ts';

/**
 * Coerces decimal-shaped strings and booleans to positive integers (`> 0`).
 * Truncation is toward zero.
 * Non-positive results, hex/octal/binary, whitespace, and unsafe results pass through.
 *
 * @example
 * ```ts
 * coerceToPositiveInteger('123') // -> 123
 * coerceToPositiveInteger('1.9') // -> 1
 * coerceToPositiveInteger('0')   // -> '0'
 * coerceToPositiveInteger('-5')  // -> '-5'
 * coerceToPositiveInteger(true)  // -> 1
 * coerceToPositiveInteger(false) // -> false
 * coerceToPositiveInteger(null)  // -> null
 * ```
 */
export function coerceToPositiveInteger<T>(value: T): T | number {
  const coerced = coerceToInteger(value);
  if (isPositiveInteger(coerced)) return coerced;
  return value;
}
