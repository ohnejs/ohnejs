import { countDecimals } from './count-decimals.ts';
import { roundTo } from './round-to.ts';

/**
 * A value scale from `0` that ends on a clean step.
 */
export interface NiceScale {
  /**
   * The value at the top of the scale, the last tick.
   */
  max: number;

  /**
   * The distance between two ticks.
   */
  step: number;

  /**
   * The tick values from `0` up to `max`, one `step` apart.
   */
  ticks: number[];
}

const FACTORS = [1, 2, 2.5, 5, 10];

/**
 * A scale from `0` that fits `peak` in about `count` steps of 1, 2, 2.5 or 5 times a power of ten.
 * With `whole`, the step never drops below `1`, so counts never get a fractional tick.
 * A `peak` of `0` or less, or one too small for a step, gets the scale of `0`, one step.
 *
 * @example
 * ```ts
 * niceScale(87)            // -> { max: 100, step: 25, ticks: [0, 25, 50, 75, 100] }
 * niceScale(3)             // -> { max: 3, step: 1, ticks: [0, 1, 2, 3] }
 * niceScale(0)             // -> { max: 1, step: 1, ticks: [0, 1] }
 * niceScale(0.8, 4, false) // -> { max: 0.8, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8] }
 * niceScale(1240, 3)       // -> { max: 1500, step: 500, ticks: [0, 500, 1000, 1500] }
 * ```
 */
export function niceScale(peak: number, count = 4, whole = true): NiceScale {
  const raw = Math.max(peak > 0 ? peak : 1, whole ? count : 0) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = FACTORS.find((candidate) => candidate * power >= raw) ?? 10;
  const exact = roundTo(factor * power, 15);
  if (exact <= 0) return niceScale(0, count, whole);
  const step = whole ? Math.max(1, Math.ceil(exact)) : exact;
  const places = countDecimals(step);
  const steps = Math.max(1, Math.ceil(roundTo(peak / step, 9)));
  const ticks = Array.from({ length: steps + 1 }, (_, index) => roundTo(index * step, places));
  return { max: ticks[steps]!, step, ticks };
}
