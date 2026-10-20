import { isRealNumber } from '../is/is-real-number.ts';

/**
 * Reads `value` as a finite number at or above 0, or `undefined` when it is none.
 *
 * @example
 * ```ts
 * nonNegativeNumber(2.5) // -> 2.5
 * nonNegativeNumber(-1)  // -> undefined
 * nonNegativeNumber('3') // -> undefined
 * ```
 */
export function nonNegativeNumber(value: unknown): number | undefined {
  return isRealNumber(value) && value >= 0 ? value : undefined;
}
