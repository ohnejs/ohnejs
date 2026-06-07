/**
 * Checks whether a value is a number, excluding `NaN`.
 * `Infinity` and `-Infinity` are accepted; use `isRealNumber` to exclude them.
 *
 * @example
 * ```ts
 * isNumber(1)        // -> true
 * isNumber(Infinity) // -> true
 * isNumber(NaN)      // -> false
 * isNumber('1')      // -> false
 * ```
 */
export function isNumber<T extends number = number>(value: unknown): value is T {
  return typeof value === 'number' && !Number.isNaN(value);
}
