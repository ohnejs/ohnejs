/**
 * Returns the first element of an array, or `undefined` if the array is empty.
 *
 * @example
 * ```ts
 * first([1, 2, 3]) // -> 1
 * first([])        // -> undefined
 * ```
 */
export function first<T>(array: readonly T[]): T | undefined {
  return array[0];
}
