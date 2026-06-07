import { isArray } from './is-array.ts';
import { isNull } from './is-null.ts';

/**
 * Checks whether a value is a non-null, non-array object.
 * Includes class instances (`Map`, `Set`, `Date`, ...).
 * Use `isPlainObject` to exclude them.
 *
 * @example
 * ```ts
 * isObject({})        // -> true
 * isObject(new Map()) // -> true
 * isObject([])        // -> false
 * isObject(null)      // -> false
 * ```
 */
export function isObject<T extends object = Record<string, unknown>>(value: unknown): value is T {
  return typeof value === 'object' && !isNull(value) && !isArray(value);
}
