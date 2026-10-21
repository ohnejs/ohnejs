import type { Amount } from '../i18n/amount.ts';

import { isCurrencyCode } from './is-currency-code.ts';
import { isInteger } from './is-integer.ts';
import { isPlainObject } from './is-plain-object.ts';

/**
 * Whether `value` is an `Amount`: a whole `minor` and a known `currency`, and no other key.
 *
 * @example
 * ```ts
 * isAmount({ minor: 1234, currency: 'EUR' })             // -> true
 * isAmount({ minor: 12.5, currency: 'EUR' })             // -> false
 * isAmount({ minor: 1234, currency: 'EUR', label: 'x' }) // -> false
 * ```
 */
export function isAmount(value: unknown): value is Amount {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    isInteger(value.minor) &&
    isCurrencyCode(value.currency)
  );
}
