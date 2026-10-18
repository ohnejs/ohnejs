import type { CurrencyCode } from './currency-digits.ts';

import { minorUnitsToDecimal } from '../number/minor-units-to-decimal.ts';
import { currencyDigits } from './currency-digits.ts';
import { formatNumberIn } from './format-number-in.ts';

/**
 * Formats an amount held in minor units as `language` writes money in `currency`.
 * The decimals are always the currency's ISO 4217 digits, and the amount never passes through a float.
 *
 * @example
 * ```ts
 * formatCurrencyIn(1234, 'EUR', 'de') // -> '12,34 €'
 * formatCurrencyIn(1234, 'JPY', 'en') // -> '¥1,234'
 * formatCurrencyIn(1234, 'KWD', 'en') // -> 'KWD 1.234'
 * ```
 */
export function formatCurrencyIn(minor: number, currency: CurrencyCode, language: string): string {
  const digits = currencyDigits[currency];
  return formatNumberIn(minorUnitsToDecimal(minor, digits), language, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
