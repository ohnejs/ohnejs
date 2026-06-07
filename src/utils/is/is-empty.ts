import { isArray } from './is-array.ts';
import { isMap } from './is-map.ts';
import { isPlainObject } from './is-plain-object.ts';
import { isSet } from './is-set.ts';
import { isString } from './is-string.ts';

interface IsEmptyOptions {
  /**
   * Treat whitespace-only strings as empty.
   * No effect on other types.
   *
   * @default
   * false
   */
  trim?: boolean;
}

/**
 * Checks whether a container is empty.
 * Returns `true` for empty strings, arrays, `Map`s, `Set`s, and plain objects.
 * Non-containers return `false`.
 *
 * @example
 * ```ts
 * isEmpty('')                   // -> true
 * isEmpty('  ')                 // -> false
 * isEmpty('  ', { trim: true }) // -> true
 * isEmpty([])                   // -> true
 * isEmpty(new Map())            // -> true
 * isEmpty({})                   // -> true
 *
 * isEmpty(null)                 // -> false
 * isEmpty(undefined)            // -> false
 * isEmpty(new Date())           // -> false
 * isEmpty(0)                    // -> false
 * ```
 */
export function isEmpty(value: unknown, options?: IsEmptyOptions): boolean {
  if (isString(value)) return (options?.trim ? value.trim() : value).length === 0;
  if (isArray(value)) return value.length === 0;
  if (isMap(value) || isSet(value)) return value.size === 0;
  if (isPlainObject(value)) return Reflect.ownKeys(value).length === 0;
  return false;
}
