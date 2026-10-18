import { isRealNumber } from '../is/is-real-number.ts';
import { alignDecimals } from './align-decimals.ts';

/**
 * Checks whether `value` lies exactly on the grid `base + k * step` for a whole `k`.
 * The check is exact in decimal, so `0.3` lies on a `0.1` grid and `0.1 + 0.2` does not.
 * A non-finite input, or a `step` that is not above 0, never lies on a grid.
 *
 * @example
 * ```ts
 * isStepMultiple(0.3, 0.1)        // -> true
 * isStepMultiple(0.1 + 0.2, 0.1)  // -> false
 * isStepMultiple(1.75, 0.5, 0.25) // -> true
 * ```
 */
export function isStepMultiple(value: number, step: number, base = 0): boolean {
  if (!isRealNumber(value) || !isRealNumber(base) || !isRealNumber(step) || step <= 0) return false;
  const {
    coefficients: [offset = 0n, unit = 1n, origin = 0n],
  } = alignDecimals([value, step, base]);
  return (offset - origin) % unit === 0n;
}
