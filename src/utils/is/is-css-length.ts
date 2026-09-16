import { isString } from './is-string.ts';

const CSS_LENGTH = /^\d+(\.\d+)?(px|rem|em|ch|vw|vh|vmin|vmax|%)$/;

/**
 * Checks whether a value is a plain CSS length or percentage: a non-negative number with a unit.
 * No keywords, no `calc()`, no unitless numbers.
 *
 * @example
 * ```ts
 * isCSSLength('320px')  // -> true
 * isCSSLength('2.5rem') // -> true
 * isCSSLength('50%')    // -> true
 * isCSSLength('auto')   // -> false
 * isCSSLength('12')     // -> false
 * ```
 */
export function isCSSLength(value: unknown): value is string {
  return isString(value) && CSS_LENGTH.test(value);
}
