/**
 * Wraps a value in an array if it is not already one.
 * Array values are returned as-is (no copy).
 *
 * @example
 * ```ts
 * toArray(1)      // -> [1]
 * toArray('a')    // -> ['a']
 * toArray([1, 2]) // -> [1, 2]
 * toArray([])     // -> []
 * ```
 */
export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
