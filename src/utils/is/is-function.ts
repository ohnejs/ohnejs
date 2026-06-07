/**
 * Checks whether a value is a function.
 * Pass a callable type parameter to narrow the signature.
 *
 * @example
 * ```ts
 * isFunction(() => 1)                       // -> true
 * isFunction(1)                             // -> false
 * if (isFunction<(x: number) => string>(v)) v(42) // typed as string
 * ```
 */
export function isFunction<T extends (...args: never[]) => unknown = (...args: never[]) => unknown>(
  value: unknown,
): value is T {
  return typeof value === 'function';
}
