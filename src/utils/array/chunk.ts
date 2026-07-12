/**
 * Splits an array into consecutive slices of `size`, the last one holding the remainder.
 * A size below `1` throws: no slicing could ever finish.
 *
 * @example
 * ```ts
 * chunk([1, 2, 3, 4, 5], 2) // -> [[1, 2], [3, 4], [5]]
 * chunk([1, 2], 3)          // -> [[1, 2]]
 * chunk([], 3)              // -> []
 * ```
 */
export function chunk<T>(array: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error(`Invalid chunk size: ${size}`);
  const slices: T[][] = [];
  for (let start = 0; start < array.length; start += size) {
    slices.push(array.slice(start, start + size));
  }
  return slices;
}
