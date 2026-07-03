import { isArray } from '../is/is-array.ts';
import { hasKey } from '../object/has-key.ts';
import {
  type DotNotationSegment,
  parseDotNotation,
  segmentAddresses,
} from './parse-dot-notation.ts';

/**
 * Returns a new value with the property at `path` removed from `value`.
 * The input is never mutated; only the touched path is cloned (structural sharing).
 *
 * A `.key` segment descends only a plain object; a `[n]` segment only an array.
 * Anything else (`Date`, `Map`, `Set`, class instances, primitives) is treated as a leaf.
 * Such values are returned unchanged.
 *
 * Removing an array element via `[n]` splices the array (shifts later indices down).
 * Arrays hold elements only: cloning through one drops named properties on it.
 *
 * If the path does not resolve, the input is returned unchanged.
 * Same reference, no clones.
 *
 * @example
 * ```ts
 * dotUnset({ a: { b: 1, c: 2 } }, 'a.b') // -> { a: { c: 2 } }
 * dotUnset({ a: [1, 2, 3] }, 'a[1]')     // -> { a: [1, 3] }
 * dotUnset({ a: 1 }, 'b')                // -> { a: 1 } (same reference)
 * ```
 */
export function dotUnset<T>(value: T, path: string): T {
  const segments = parseDotNotation(path);
  return unsetRecursive(value, segments, 0) as T;
}

function unsetRecursive(current: unknown, segments: DotNotationSegment[], index: number): unknown {
  const segment = segments[index] as DotNotationSegment;
  if (!segmentAddresses(segment, current)) return current;
  if (!hasKey(current, segment.value)) return current;

  if (index === segments.length - 1) {
    if (isArray(current) && segment.kind === 'index') {
      const copy = current.slice();
      copy.splice(segment.value, 1);
      return copy;
    }
    const copy = { ...(current as Record<PropertyKey, unknown>) };
    delete copy[segment.value];
    return copy;
  }

  const child = (current as Record<PropertyKey, unknown>)[segment.value];
  const newChild = unsetRecursive(child, segments, index + 1);
  if (newChild === child) return current;

  if (isArray(current)) {
    const copy = current.slice();
    (copy as unknown as Record<PropertyKey, unknown>)[segment.value] = newChild;
    return copy;
  }
  return { ...(current as Record<PropertyKey, unknown>), [segment.value]: newChild };
}
