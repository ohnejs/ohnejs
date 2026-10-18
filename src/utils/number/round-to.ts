import { isRealNumber } from '../is/is-real-number.ts';
import { alignDecimals } from './align-decimals.ts';

/**
 * Rounds `value` to `places` decimal places, halves toward positive infinity as `Math.round` does.
 * It rounds the shortest decimal the number prints as, so `1.005` rounds to `1.01`.
 * Negative `places` round to tens, hundreds, and beyond.
 *
 * A value with no more decimals than `places` passes through unchanged, and so does a non-finite one.
 *
 * @example
 * ```ts
 * roundTo(1.5, 0)        // -> 2
 * roundTo(1.005, 2)      // -> 1.01
 * roundTo(0.1 + 0.2, 1)  // -> 0.3
 * roundTo(1250, -2)      // -> 1300
 * roundTo(1.5, Infinity) // -> 1.5
 * ```
 */
export function roundTo(value: number, places: number): number {
  if (!isRealNumber(value)) return value;
  const {
    coefficients: [digits = 0n],
    scale,
  } = alignDecimals([value]);
  const dropped = scale - places;
  if (dropped <= 0) return value;
  const unit = 10n ** BigInt(dropped);
  const halfUp = digits + unit / 2n;
  const floored = halfUp / unit - (halfUp % unit < 0n ? 1n : 0n);
  return Number(`${floored}e${-places}`);
}
