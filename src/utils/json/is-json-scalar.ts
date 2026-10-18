import { isBoolean } from '../is/is-boolean.ts';
import { isNull } from '../is/is-null.ts';
import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';

/**
 * Checks whether a value is a JSON leaf: `null`, a string, a boolean, or a finite number.
 *
 * @example
 * ```ts
 * isJSONScalar(1)   // -> true
 * isJSONScalar(NaN) // -> false
 * isJSONScalar([])  // -> false
 * ```
 */
export function isJSONScalar(value: unknown): value is string | number | boolean | null {
  return isNull(value) || isString(value) || isBoolean(value) || isRealNumber(value);
}
