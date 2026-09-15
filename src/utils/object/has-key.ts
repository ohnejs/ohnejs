/**
 * Checks whether `value` has `key` as an own property.
 *
 * Own-only: inherited names (`toString`, `constructor`, `hasOwnProperty`, ...) return `false`.
 *
 * @example
 * ```ts
 * hasKey({ a: 1 }, 'a')  // -> true
 * hasKey({ a: 1 }, 'b')  // -> false
 * hasKey({}, 'toString') // -> false
 * ```
 */
export function hasKey<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & { [P in K]: P extends keyof T ? T[P] : unknown } {
  return Object.hasOwn(value, key);
}
