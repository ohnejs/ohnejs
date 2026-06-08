import { hasKey } from './has-key.ts';

/**
 * Checks whether `value` has every listed key as an own property.
 * Narrows the type so each is accessible after the check.
 *
 * @example
 * ```ts
 * hasKeys({ a: 1, b: 2 }, ['a', 'b']) // -> true
 * hasKeys({ a: 1 }, ['a', 'b'])       // -> false
 * hasKeys({}, [])                     // -> true
 * ```
 */
export function hasKeys<T extends object, K extends PropertyKey>(
  value: T,
  keys: readonly K[],
): value is T & { [P in K]: P extends keyof T ? T[P] : unknown } {
  for (const key of keys) {
    if (!hasKey(value, key)) return false;
  }
  return true;
}
