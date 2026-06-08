import { hasKey } from './has-key.ts';

/**
 * Returns a new object with only the listed own keys.
 * Keys that are not own properties of `obj` are skipped.
 * `__proto__`, `constructor`, and `prototype` are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // -> { a: 1, c: 3 }
 * ```
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (hasKey(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result;
}
