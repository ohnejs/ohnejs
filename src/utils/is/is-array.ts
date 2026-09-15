/**
 * Checks whether a value is an array.
 *
 * @example
 * ```ts
 * isArray([1, 2]) // -> true
 * isArray('a,b')  // -> false
 * ```
 */
export function isArray<T extends unknown[] = unknown[]>(value: unknown): value is T {
  return Array.isArray(value);
}
