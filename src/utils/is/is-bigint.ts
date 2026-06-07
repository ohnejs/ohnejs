/**
 * Checks whether a value is a `bigint`.
 *
 * @example
 * ```ts
 * isBigInt(42n) // -> true
 * isBigInt(42)  // -> false
 * ```
 */
export function isBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint';
}
