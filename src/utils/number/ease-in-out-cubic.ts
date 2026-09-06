import { clamp } from './clamp.ts';

/**
 * Eases `t` across `[0, 1]` with a cubic curve, slow at both ends and fastest in the middle.
 * It is the symmetric cubic: `4t³` up to the midpoint, then the mirrored cubic out.
 *
 * `t` is clamped to `[0, 1]` first.
 *
 * @example
 * ```ts
 * easeInOutCubic(0)    // -> 0
 * easeInOutCubic(0.25) // -> 0.0625
 * easeInOutCubic(0.5)  // -> 0.5
 * easeInOutCubic(0.75) // -> 0.9375
 * easeInOutCubic(1)    // -> 1
 * ```
 */
export function easeInOutCubic(t: number): number {
  const v = clamp(t, 0, 1);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}
