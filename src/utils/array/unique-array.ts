/**
 * Returns a new array with duplicate values removed, preserving the order of first occurrence.
 * Uses strict equality (`===`) for comparison.
 *
 * @example
 * ```ts
 * uniqueArray([1, 2, 2, 3, 1]) // -> [1, 2, 3]
 * uniqueArray(['a', 'b', 'a']) // -> ['a', 'b']
 * ```
 */
export function uniqueArray<T>(array: readonly T[]): T[] {
  return [...new Set(array)];
}
