/**
 * Returns each value that occurs more than once, in the order it first repeats.
 *
 * @example
 * ```ts
 * duplicates(['a', 'b', 'a', 'c', 'b', 'a']) // -> ['a', 'b']
 * duplicates([1, 2, 3])                      // -> []
 * ```
 */
export function duplicates<T>(array: readonly T[]): T[] {
  const seen = new Set<T>();
  const repeated = new Set<T>();
  for (const value of array) {
    if (seen.has(value)) repeated.add(value);
    else seen.add(value);
  }
  return [...repeated];
}
