import { isArray } from '../is/is-array.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isNull } from '../is/is-null.ts';
import { isNumber } from '../is/is-number.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';

/**
 * Checks whether a value is plain JSON data, exactly as `JSON.stringify` would keep it.
 * Accepts `null`, strings, booleans, finite numbers, and arrays and plain objects of the same.
 * Anything JSON would drop or distort - a function, a `Date`, `NaN`, a class instance - fails.
 *
 * @example
 * ```ts
 * isJSONValue({ tags: ['a', 'b'], max: 3 }) // -> true
 * isJSONValue([1, () => 2])                 // -> false
 * isJSONValue(new Date())                   // -> false
 * isJSONValue(NaN)                          // -> false
 * ```
 */
export function isJSONValue(value: unknown): boolean {
  if (isNull(value) || isString(value) || isBoolean(value)) return true;
  if (isNumber(value)) return isRealNumber(value);
  if (isArray(value)) return value.every(isJSONValue);
  if (isPlainObject(value)) return Object.values(value).every(isJSONValue);
  return false;
}
