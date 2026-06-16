import { isNull } from './is-null.ts';
import { isObject } from './is-object.ts';

/**
 * Checks whether a value is a plain object: prototype is `Object.prototype` or `null`.
 * Excludes arrays, `Map`, `Set`, `Date`, and other class instances.
 *
 * @example
 * ```ts
 * isPlainObject({})                  // -> true
 * isPlainObject(Object.create(null)) // -> true
 * isPlainObject(new Map())           // -> false
 * isPlainObject([])                  // -> false
 * ```
 */
export function isPlainObject<T extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
): value is T {
  if (!isObject(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || isNull(proto);
}
