import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';

/**
 * A deep copy of a JSON-shaped value with every listed key removed, at every depth.
 * Arrays copy element-wise, plain objects copy their remaining entries, anything else passes through.
 * `__proto__`, `constructor`, and `prototype` keys are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * deepOmit({ id: 1, rows: [{ id: 2, name: 'a' }] }, ['id'])
 * // -> { rows: [{ name: 'a' }] }
 *
 * deepOmit([{ a: 1, b: 2 }], ['b'])
 * // -> [{ a: 1 }]
 * ```
 */
export function deepOmit(value: unknown, keys: readonly string[]): unknown {
  if (isArray(value)) return value.map((entry) => deepOmit(entry, keys));
  if (isPlainObject<Record<string, unknown>>(value)) {
    const clean: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (!keys.includes(key)) clean[key] = deepOmit(entry, keys);
    }
    return clean;
  }
  return value;
}
