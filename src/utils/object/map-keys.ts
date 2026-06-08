/**
 * Returns a new object with values from `obj` re-keyed by `fn`.
 * If `fn` returns the same key for multiple inputs, the later value wins.
 * Symbol keys are not visited.
 *
 * @example
 * ```ts
 * mapKeys({ a: 1, b: 2 }, (key) => key.toUpperCase())
 * // -> { A: 1, B: 2 }
 *
 * mapKeys({ a: 1, b: 2 }, (key, n) => `${key}${n}`)
 * // -> { a1: 1, b2: 2 }
 * ```
 */
export function mapKeys<T extends object, K extends PropertyKey>(
  obj: T,
  fn: (key: keyof T, value: T[keyof T]) => K,
): Record<K, T[keyof T]> {
  const result = Object.create(null) as Record<K, T[keyof T]>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    result[fn(key, value)] = value;
  }
  return result;
}
