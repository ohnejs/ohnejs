/**
 * Maps each own value of `obj` through `fn`, keeping the same keys.
 * `fn` receives the key and its value.
 * Symbol keys are not visited.
 * `__proto__`, `constructor`, and `prototype` are dropped to prevent prototype pollution.
 *
 * @example
 * ```ts
 * mapValues({ a: 1, b: 2 }, (_, n) => n * 2)
 * // -> { a: 2, b: 4 }
 *
 * mapValues({ a: 1, b: 2 }, (key, n) => `${key}=${n}`)
 * // -> { a: 'a=1', b: 'b=2' }
 * ```
 */
export function mapValues<T extends object, U>(
  obj: T,
  fn: (key: keyof T, value: T[keyof T]) => U,
): { [K in keyof T]: U } {
  const result = {} as { [K in keyof T]: U };
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    result[key] = fn(key, obj[key]);
  }
  return result;
}
