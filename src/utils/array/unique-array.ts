/**
 * Returns a new array with duplicates removed, preserving order.
 *
 * @example
 * ```ts
 * uniqueArray([1, 2, 2, 3, 1]) // -> [1, 2, 3]
 * ```
 */
export function uniqueArray<T>(array: readonly T[]): T[] {
  return [...new Set(array)];
}
