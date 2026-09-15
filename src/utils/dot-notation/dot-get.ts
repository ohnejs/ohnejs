import { parseDotNotation, segmentAddresses } from './parse-dot-notation.ts';

/**
 * Reads the value at `path` inside `value`.
 * A `.key` segment descends only a plain object; a `[n]` segment only an array.
 * Anything else (`Date`, `Map`, `Set`, class instances, primitives) is treated as a leaf.
 * A segment that does not resolve yields `undefined`.
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
 * ```
 */
export function dotGet<T = unknown>(value: unknown, path: string): T | undefined {
  const segments = parseDotNotation(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (!segmentAddresses(segment, current)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment.value];
  }
  return current as T | undefined;
}
