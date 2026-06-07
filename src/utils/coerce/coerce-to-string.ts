import { isBigInt } from '../is/is-bigint.ts';
import { isBoolean } from '../is/is-boolean.ts';

/**
 * Coerces numbers, booleans, and bigints to their `String()` form.
 * Other types pass through unchanged.
 *
 * @example
 * ```ts
 * coerceToString(123)    // -> '123'
 * coerceToString(NaN)    // -> 'NaN'
 * coerceToString(123n)   // -> '123'
 * coerceToString(true)   // -> 'true'
 * coerceToString(null)   // -> null
 * coerceToString([1, 2]) // -> [1, 2]
 * ```
 */
export function coerceToString<T>(value: T): T | string {
  if (typeof value === 'number' || isBoolean(value) || isBigInt(value)) return String(value);
  return value;
}
