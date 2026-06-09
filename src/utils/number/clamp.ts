/**
 * Returns `value` constrained to the inclusive range `[min, max]`.
 *
 * `NaN` passes through unchanged.
 *
 * @example
 * ```ts
 * clamp(5, 0, 10)   // -> 5
 * clamp(-3, 0, 10)  // -> 0
 * clamp(42, 0, 10)  // -> 10
 * clamp(NaN, 0, 10) // -> NaN
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
