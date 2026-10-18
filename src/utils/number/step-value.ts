import type { ValidationBounds } from '../validate/validation-failure.ts';

import { isRealNumber } from '../is/is-real-number.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { alignDecimals } from './align-decimals.ts';

/**
 * A grid of legal values: every `min + k * step`, or `k * step` without `min`, within the bounds.
 */
export interface StepGrid extends ValidationBounds {
  /**
   * The distance between neighbouring grid points, above 0.
   *
   * @default
   * 1
   */
  readonly step?: number | undefined;
}

/**
 * Moves `value` by `count` steps along a grid, exact in decimal, as an input's arrow keys do.
 * An off-grid value first lands on the nearest grid point in the direction of travel.
 * The result stays on the last grid point inside `min` and `max`, never on a bound off the grid.
 * A non-finite value passes through unchanged.
 *
 * @example
 * ```ts
 * stepValue(0.1 + 0.2, 1, { step: 0.1 })          // -> 0.4
 * stepValue(0.3, -1, { step: 0.25 })              // -> 0.25
 * stepValue(1.6, 1, { step: 0.5, min: 0.25 })     // -> 1.75
 * stepValue(9, 1, { step: 3, min: 0, max: 10 })   // -> 9
 * stepValue(2, -5, { step: 0.5, min: 1, max: 3 }) // -> 1
 * ```
 */
export function stepValue(value: number, count: number, grid: StepGrid): number {
  if (!isRealNumber(value)) return value;
  const { step = 1, min, max } = grid;
  const base = min ?? 0;
  const {
    coefficients: [at = 0n, unit = 1n, origin = 0n, top = 0n],
    scale,
  } = alignDecimals([value, step, base, max ?? base]);
  const offset = at - origin;
  const landed = count >= 0 ? floorDivide(offset, unit) : ceilDivide(offset, unit);
  let index = landed + BigInt(count);
  if (!isUndefined(min) && index < 0n) index = 0n;
  if (!isUndefined(max)) {
    const last = floorDivide(top - origin, unit);
    if (index > last) index = last;
  }
  return Number(`${origin + index * unit}e-${scale}`);
}

/**
 * `a / b` rounded toward negative infinity, for a positive `b`.
 */
function floorDivide(a: bigint, b: bigint): bigint {
  return a / b - (a % b < 0n ? 1n : 0n);
}

/**
 * `a / b` rounded toward positive infinity, for a positive `b`.
 */
function ceilDivide(a: bigint, b: bigint): bigint {
  return a / b + (a % b > 0n ? 1n : 0n);
}
