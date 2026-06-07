/**
 * Checks whether a value is a `RegExp`.
 *
 * @example
 * ```ts
 * isRegExp(/x/) // -> true
 * isRegExp('x') // -> false
 * ```
 */
export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}
