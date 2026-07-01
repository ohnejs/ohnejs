/**
 * Returns a new object with all own keys of `obj` except the listed ones.
 * Symbol keys are not copied.
 * `__proto__`, `constructor`, and `prototype` are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * omit({ a: 1, b: 2, c: 3 }, ['b']) // -> { a: 1, c: 3 }
 * ```
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const drop = new Set<PropertyKey>(keys);
  const result = {} as Omit<T, K>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!drop.has(key)) {
      (result as T)[key] = obj[key];
    }
  }
  return result;
}
