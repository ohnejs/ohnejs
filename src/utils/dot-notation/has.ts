import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { hasKey } from '../object/has-key.ts';
import { parseDotNotation } from './parse-dot-notation.ts';

/**
 * Checks whether `path` resolves to an own property of `value`.
 * Descends only plain objects and arrays.
 * Anything else (`Date`, `Map`, `Set`, class instances, primitives) is treated as a leaf; returns `false`.
 *
 * Returns `true` even if the resolved value is `undefined`, as long as the key is set.
 * Own-only at every step: inherited names (`toString`, `constructor`, ...) return `false`.
 *
 * @example
 * ```ts
 * has({ a: { b: 1 } }, 'a.b')         // -> true
 * has({ a: { b: undefined } }, 'a.b') // -> true
 * has({ a: { b: 1 } }, 'a.c')         // -> false
 * has({ a: [10] }, 'a[0]')            // -> true
 * has({ a: [10] }, 'a[5]')            // -> false
 * has({}, 'toString')                 // -> false
 * has(new Map([['k', 1]]), 'k')       // -> false (Map is a leaf)
 * ```
 */
export function has(value: unknown, path: string): boolean {
  const segments = parseDotNotation(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (!isPlainObject(current) && !isArray(current)) return false;
    if (!hasKey(current, segment.value)) return false;
    current = (current as Record<PropertyKey, unknown>)[segment.value];
  }
  return true;
}
