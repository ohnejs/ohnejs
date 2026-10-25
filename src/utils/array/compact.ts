import { isNullish } from '../is/is-nullish.ts';

/**
 * Returns `items` without its `false`, `null`, and `undefined` entries.
 * Other falsy values such as `0` and `''` stay.
 *
 * @example
 * ```ts
 * compact([1, false, 2, null, 0, undefined]) // -> [1, 2, 0]
 * compact([])                                // -> []
 * ```
 */
export function compact<T>(items: readonly (T | false | null | undefined)[]): T[] {
  return items.filter((item): item is T => item !== false && !isNullish(item));
}
