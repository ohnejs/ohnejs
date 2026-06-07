import { isString } from '../is/is-string.ts';

/**
 * Coerces `1` / `0` and case-insensitive `'true'` / `'false'` / `'1'` / `'0'` to booleans.
 * Other types pass through unchanged.
 *
 * @example
 * ```ts
 * coerceToBoolean(1)       // -> true
 * coerceToBoolean('FALSE') // -> false
 * coerceToBoolean('0')     // -> false
 * coerceToBoolean(2)       // -> 2
 * coerceToBoolean(null)    // -> null
 * ```
 */
export function coerceToBoolean<T>(value: T): T | boolean {
  if (value === 1) return true;
  if (value === 0) return false;
  if (isString(value)) {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return value;
}
