/**
 * Checks whether a value is a finite number (excludes `NaN`, `Infinity`, `-Infinity`).
 *
 * @example
 * ```ts
 * isRealNumber(1.5)      // -> true
 * isRealNumber(Infinity) // -> false
 * isRealNumber(NaN)      // -> false
 * ```
 */
export function isRealNumber(value: unknown): value is number {
  return Number.isFinite(value);
}
