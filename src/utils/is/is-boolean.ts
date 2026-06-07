/**
 * Checks whether a value is a boolean.
 *
 * @example
 * ```ts
 * isBoolean(true) // -> true
 * isBoolean(0)    // -> false
 * ```
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
