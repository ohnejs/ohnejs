import { jsonChildren } from './_json-children.ts';
import { isJSONScalar } from './is-json-scalar.ts';

/**
 * Checks whether a value is plain JSON data, exactly as `JSON.stringify` would keep it.
 * Accepts `null`, strings, booleans, finite numbers, and arrays and plain objects of the same.
 * Anything JSON would drop or distort - a function, a `Date`, `NaN`, a class instance - fails.
 * So does an array with holes or extra keys, and an object with symbol keys.
 *
 * @example
 * ```ts
 * isJSONValue({ tags: ['a', 'b'], max: 3 }) // -> true
 * isJSONValue([1, () => 2])                 // -> false
 * isJSONValue(new Date())                   // -> false
 * isJSONValue(NaN)                          // -> false
 * isJSONValue([, 1])                        // -> false
 * isJSONValue({ a: undefined })             // -> false
 * ```
 */
export function isJSONValue(value: unknown): boolean {
  return isJSONScalar(value) || (jsonChildren(value)?.every(isJSONValue) ?? false);
}
