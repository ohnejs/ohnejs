import { isArray } from '../is/is-array.ts';
import { isFunction } from '../is/is-function.ts';
import { isNullish } from '../is/is-nullish.ts';
import { isString } from '../is/is-string.ts';

type ToArray<T> = T extends readonly unknown[]
  ? T
  : T extends string
    ? T[]
    : T extends Iterable<infer U>
      ? U[]
      : T[];

/**
 * Converts a value to an array.
 * Arrays pass through (same reference).
 * Strings are wrapped, not split into characters.
 * Non-string iterables (`Set`, `Map`, generators, ...) are spread via `Array.from`.
 * Everything else is wrapped in a single-element array.
 *
 * @example
 * ```ts
 * toArray(1)                   // -> [1]
 * toArray('abc')               // -> ['abc']
 * toArray([1, 2])              // -> [1, 2]
 * toArray(new Set([1, 2]))     // -> [1, 2]
 * toArray(new Map([['a', 1]])) // -> [['a', 1]]
 * toArray(null)                // -> [null]
 * ```
 */
export function toArray<T>(value: T): ToArray<T> {
  if (isArray(value)) return value as ToArray<T>;
  if (isString(value)) return [value] as ToArray<T>;
  if (
    !isNullish(value) &&
    isFunction((value as { [Symbol.iterator]?: unknown })[Symbol.iterator])
  ) {
    return Array.from(value as unknown as Iterable<unknown>) as ToArray<T>;
  }
  return [value] as ToArray<T>;
}
