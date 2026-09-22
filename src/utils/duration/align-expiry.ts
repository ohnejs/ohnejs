import { isRealNumber } from '../is/is-real-number.ts';

/**
 * The end of the window after the one holding `now`, in the unit `now` and `window` share.
 * Values minted anywhere inside one window expire together, and every one lives at least a full window.
 *
 * A `window` that is not a positive finite number throws.
 *
 * @example
 * ```ts
 * alignExpiry(1000, 1000) // -> 3000
 * alignExpiry(1500, 1000) // -> 3000
 * alignExpiry(2000, 1000) // -> 4000
 * ```
 */
export function alignExpiry(now: number, window: number): number {
  if (!isRealNumber(window) || window <= 0) throw new Error(`Invalid window: ${window}`);
  return (Math.floor(now / window) + 2) * window;
}
