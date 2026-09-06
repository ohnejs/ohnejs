import { clamp } from './clamp.ts';

/**
 * Eases `t` across `[0, 1]` with the Hermite smoothstep curve `3t² - 2t³`.
 * It starts and ends with zero velocity, so windows chained through it join without a kink.
 *
 * `t` is clamped to `[0, 1]` first.
 *
 * @example
 * ```ts
 * smoothstep(0)    // -> 0
 * smoothstep(0.25) // -> 0.15625
 * smoothstep(0.5)  // -> 0.5
 * smoothstep(1)    // -> 1
 * smoothstep(1.7)  // -> 1
 * ```
 */
export function smoothstep(t: number): number {
  const v = clamp(t, 0, 1);
  return v * v * (3 - 2 * v);
}
