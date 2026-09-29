import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';

/**
 * Checks whether a value has the shape of a message: a string, or an object with a string `key`.
 * The string is a message key or plain text; the object is a `{ key, params }` pair.
 * Neither the key nor the parameters are checked against a catalog.
 *
 * @example
 * ```ts
 * isMessage('dashboard.yes')                        // -> true
 * isMessage({ key: 'field.min', params: { n: 2 } }) // -> true
 * isMessage({ params: {} })                         // -> false
 * isMessage(42)                                     // -> false
 * ```
 */
export function isMessage(value: unknown): value is string | { key: string } {
  return isString(value) || (isPlainObject(value) && isString(value.key));
}
