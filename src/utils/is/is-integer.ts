/**
 * Checks whether a value is a safe integer (within `Number.MAX_SAFE_INTEGER`).
 * Integers beyond that range lose precision and return `false`.
 *
 * @example
 * ```ts
 * isInteger(42)      // -> true
 * isInteger(1.5)     // -> false
 * isInteger(2 ** 53) // -> false
 * isInteger(NaN)     // -> false
 * ```
 */
export function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}
