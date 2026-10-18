import type { CurrencyCode } from '../i18n/currency-digits.ts';

import { currencyDigits } from '../i18n/currency-digits.ts';
import { isString } from './is-string.ts';

/**
 * Checks whether a value is the ISO 4217 code of a circulating currency, in upper case.
 * Intl formats any well-formed code, so this reads the `currencyDigits` table instead.
 *
 * @example
 * ```ts
 * isCurrencyCode('EUR') // -> true
 * isCurrencyCode('eur') // -> false
 * isCurrencyCode('XAU') // -> false
 * ```
 */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return isString(value) && Object.hasOwn(currencyDigits, value);
}
