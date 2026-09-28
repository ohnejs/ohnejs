/**
 * Returns `value` modulo `divisor`, floored so the result takes the sign of `divisor`.
 * Unlike `%`, a negative `value` wraps into `[0, divisor)` for a positive `divisor`.
 *
 * @example
 * ```ts
 * modulo(7, 3)        // -> 1
 * modulo(-1, 12)      // -> 11
 * modulo(-1500, 1000) // -> 500
 * modulo(1, -12)      // -> -11
 * ```
 */
export function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
