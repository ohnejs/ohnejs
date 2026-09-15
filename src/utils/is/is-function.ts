/**
 * Checks whether a value is a function.
 *
 * @example
 * ```ts
 * isFunction(() => 1) // -> true
 * isFunction(1)       // -> false
 * ```
 */
export function isFunction<T extends (...args: never[]) => unknown = (...args: never[]) => unknown>(
  value: unknown,
): value is T {
  return typeof value === 'function';
}
