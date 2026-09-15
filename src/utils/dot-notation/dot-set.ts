import { isArray } from '../is/is-array.ts';
import { isNull } from '../is/is-null.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { type DotNotationSegment, parseDotNotation } from './parse-dot-notation.ts';

/**
 * Returns a new value with `newValue` written at `path` inside `value`.
 * The input is never mutated; only the touched path is cloned (structural sharing).
 *
 * Missing parents are auto-created based on the next segment: `[n]` -> array, `.key` -> object.
 * So `dotSet({}, 'a[0].b', 1)` yields `{ a: [{ b: 1 }] }`.
 *
 * Type mismatches along the path are replaced wholesale to match the path expression's intent.
 * A key segment on a non-plain-object replaces with `{}`.
 * An index segment on a non-array replaces with `[]`.
 * Arrays hold elements only: cloning through one drops named properties on it.
 *
 * Paths through `__proto__`, `constructor`, or `prototype` are no-ops (prototype pollution guard).
 *
 * @example
 * ```ts
 * dotSet({ a: { b: 1 } }, 'a.b', 2)       // -> { a: { b: 2 } }
 * dotSet({}, 'a[0].b', 1)                 // -> { a: [{ b: 1 }] }
 * dotSet({ a: { b: 1, c: 2 } }, 'a.b', 9) // -> { a: { b: 9, c: 2 } }
 * dotSet(undefined, '[0][0]', 'x')        // -> [['x']]
 * ```
 */
export function dotSet<T extends Record<string, unknown> | unknown[]>(
  value: T,
  path: string,
  newValue: unknown,
): T;
export function dotSet(
  value: unknown,
  path: string,
  newValue: unknown,
): Record<string, unknown> | unknown[];
export function dotSet(value: unknown, path: string, newValue: unknown): unknown {
  const segments = parseDotNotation(path);
  for (const segment of segments) {
    if (
      segment.kind === 'key' &&
      (segment.value === '__proto__' ||
        segment.value === 'constructor' ||
        segment.value === 'prototype')
    ) {
      return value;
    }
  }
  return setRecursive(value, segments, 0, newValue);
}

/**
 * Copies `current` with `newValue` at `segments[index]` onward, creating or replacing containers to fit.
 */
function setRecursive(
  current: unknown,
  segments: DotNotationSegment[],
  index: number,
  newValue: unknown,
): unknown {
  const segment = segments[index] as DotNotationSegment;

  let container: Record<PropertyKey, unknown>;
  if (segment.kind === 'index') {
    container = (isArray(current) ? current.slice() : []) as unknown as Record<
      PropertyKey,
      unknown
    >;
  } else if (isPlainObject(current)) {
    container = { ...(current as Record<PropertyKey, unknown>) };
    if (isNull(Object.getPrototypeOf(current))) Object.setPrototypeOf(container, null);
  } else {
    container = {};
  }

  if (index === segments.length - 1) {
    container[segment.value] = newValue;
  } else {
    container[segment.value] = setRecursive(
      container[segment.value],
      segments,
      index + 1,
      newValue,
    );
  }

  return container;
}
