import type { MessageData } from './message-data.ts';

import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Checks whether a value has the shape of a message: a string, or an object with a string `key`.
 * The string is a message key or plain text; the object is a `{ key, params }` pair.
 * Its `params`, when present, must be a plain object.
 * Neither the key nor the parameters are checked against a catalog.
 *
 * @example
 * ```ts
 * isMessage('dashboard.yes')                        // -> true
 * isMessage({ key: 'field.min', params: { n: 2 } }) // -> true
 * isMessage({ key: 'field.min', params: 2 })        // -> false
 * isMessage({ params: {} })                         // -> false
 * isMessage(42)                                     // -> false
 * ```
 */
export function isMessage(value: unknown): value is MessageData {
  return (
    isString(value) ||
    (isPlainObject(value) &&
      isString(value.key) &&
      (isUndefined(value.params) || isPlainObject(value.params)))
  );
}
