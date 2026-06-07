/**
 * Checks whether a value is a string.
 *
 * @example
 * ```ts
 * isString('hello') // -> true
 * isString(42)      // -> false
 * ```
 */
export function isString<T extends string = string>(value: unknown): value is T {
  return typeof value === 'string';
}
