/**
 * Returns the last element of an array, or `undefined` if the array is empty.
 *
 * @example
 * ```ts
 * last([1, 2, 3]) // -> 3
 * last([])        // -> undefined
 * ```
 */
export function last<T>(array: readonly T[]): T | undefined {
  return array[array.length - 1];
}
