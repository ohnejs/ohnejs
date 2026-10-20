import type { CurrencyCode } from './currency-digits.ts';

import { minorUnitsToDecimal } from '../number/minor-units-to-decimal.ts';
import { currencyDigits } from './currency-digits.ts';

/**
 * Writes an amount held in minor units as its exact major decimal and its ISO 4217 code.
 * It reads the same in every language, so it suits a message the server words.
 *
 * @example
 * ```ts
 * amountWithCode(1234, 'EUR') // -> '12.34 EUR'
 * amountWithCode(1234, 'JPY') // -> '1234 JPY'
 * ```
 */
export function amountWithCode(minor: number, currency: CurrencyCode): string {
  return `${minorUnitsToDecimal(minor, currencyDigits[currency])} ${currency}`;
}
