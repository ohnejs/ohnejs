import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { parseDotNotation } from './parse-dot-notation.ts';

/**
 * Reads the value at `path` inside `value`.
 * Descends only plain objects and arrays.
 * Anything else (`Date`, `Map`, `Set`, class instances, primitives) is treated as a leaf; returns `undefined`.
 *
 * Inside a plain object, inherited properties are returned (uses bracket access, not own-property check).
 * To distinguish "missing" from "present and undefined", use `dotHas`.
 *
 * @example
 * ```ts
 * dotGet({ a: { b: [10, 20] } }, 'a.b[1]') // -> 20
 * dotGet({ a: { b: [10, 20] } }, 'a.c')    // -> undefined
 * dotGet({ a: null }, 'a.b')               // -> undefined
 * dotGet(new Map([['k', 1]]), 'k')         // -> undefined (Map is a leaf)
 *
 * dotGet<number>({ a: 1 }, 'a')            // -> 1 (typed as number | undefined)
 * ```
 */
export function dotGet<T = unknown>(value: unknown, path: string): T | undefined {
  const segments = parseDotNotation(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (!isPlainObject(current) && !isArray(current)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment.value];
  }
  return current as T | undefined;
}
