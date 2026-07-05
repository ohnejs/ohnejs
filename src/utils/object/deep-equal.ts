import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { hasKey } from './has-key.ts';

/**
 * Compares two JSON-shaped values structurally.
 * Primitives compare with `Object.is` semantics, so `NaN` equals `NaN` and `0` differs from `-0`.
 * Arrays compare by length and element order; plain objects by own enumerable keys, in any order.
 * Prototype-insensitive: a null-prototype object equals a literal with the same entries.
 * Anything else - class instances, `Map`, `Date` - is only equal to itself by reference.
 *
 * @example
 * ```ts
 * deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) // -> true
 * deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })             // -> true
 * deepEqual([1, 2], [2, 1])                             // -> false
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (isArray(a) && isArray(b)) {
    return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => hasKey(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}
