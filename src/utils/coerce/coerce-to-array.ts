import { isArray } from '../is/is-array.ts';

/**
 * Coerces a value to an array by wrapping non-arrays.
 * Arrays are returned as-is (no copy).
 *
 * @example
 * ```ts
 * coerceToArray(1)      // -> [1]
 * coerceToArray('a')    // -> ['a']
 * coerceToArray([1, 2]) // -> [1, 2]
 * coerceToArray([])     // -> []
 * ```
 */
export function coerceToArray<T>(value: T | T[]): T[] {
  return isArray<T[]>(value) ? value : [value];
}
