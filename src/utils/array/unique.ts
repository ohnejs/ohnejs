/**
 * Returns a new array with duplicates removed, preserving order.
 *
 * @example
 * ```ts
 * unique([1, 2, 2, 3, 1]) // -> [1, 2, 3]
 * ```
 */
export function unique<T>(array: readonly T[]): T[] {
  return [...new Set(array)];
}
