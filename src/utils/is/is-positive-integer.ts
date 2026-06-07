import { isInteger } from './is-integer.ts';

/**
 * Checks whether a value is a positive integer (`> 0`).
 *
 * @example
 * ```ts
 * isPositiveInteger(1)  // -> true
 * isPositiveInteger(0)  // -> false
 * isPositiveInteger(-1) // -> false
 * ```
 */
export function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}
