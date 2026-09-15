import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * Flattens a nested structure into a single-level object whose keys are dot/bracket paths.
 * Object children become `.key` segments; array children become `[n]` segments.
 *
 * Descends only plain objects and arrays.
 * Anything else (`Date`, `Map`, `Set`, class instances, primitives) is treated as a leaf.
 * Nested empty objects and arrays are preserved as leaves.
 * A key that is empty or holds `.`, `[`, or `]` throws, since no path could address it.
 *
 * @example
 * ```ts
 * dotFlatten({ a: { b: 1, c: [2, 3] } })
 * // -> { 'a.b': 1, 'a.c[0]': 2, 'a.c[1]': 3 }
 *
 * dotFlatten({ a: {}, b: [] })
 * // -> { a: {}, b: [] }
 *
 * dotFlatten([{ x: 1 }, { x: 2 }])
 * // -> { '[0].x': 1, '[1].x': 2 }
 * ```
 */
export function dotFlatten(
  value: Record<string, unknown> | readonly unknown[],
): Record<string, unknown> {
  if (!isPlainObject(value) && !isArray(value)) {
    throw new TypeError('dotFlatten: input must be a plain object or array');
  }
  const result: Record<string, unknown> = {};
  flattenInto(value, '', result);
  return result;
}

/**
 * Writes each leaf of `value` into `result` under its path from `prefix`, skipping prototype-polluting keys.
 */
function flattenInto(value: unknown, prefix: string, result: Record<string, unknown>): void {
  if (isArray(value)) {
    if (value.length === 0) {
      if (prefix !== '') result[prefix] = value;
      return;
    }
    for (let i = 0; i < value.length; i++) {
      flattenInto(value[i], `${prefix}[${i}]`, result);
    }
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      if (prefix !== '') result[prefix] = value;
      return;
    }
    for (const key of keys) {
      if (key === '' || key.includes('.') || key.includes('[') || key.includes(']')) {
        throw new Error(
          `dotFlatten: key "${key}" contains a reserved character (".", "[", "]") or is empty`,
        );
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const next = prefix === '' ? key : `${prefix}.${key}`;
      flattenInto(value[key], next, result);
    }
    return;
  }
  result[prefix] = value;
}
