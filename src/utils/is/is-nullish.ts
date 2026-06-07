import { isNull } from './is-null.ts';
import { isUndefined } from './is-undefined.ts';

/**
 * Checks whether a value is `null` or `undefined`.
 *
 * @example
 * ```ts
 * isNullish(null)      // -> true
 * isNullish(undefined) // -> true
 * isNullish(0)         // -> false
 * ```
 */
export function isNullish(value: unknown): value is null | undefined {
  return isNull(value) || isUndefined(value);
}
