import type { CurrencyCode } from './currency-digits.ts';

import { intlLanguage } from './intl-language.ts';

/**
 * Where `language` writes the symbol of `currency` around an amount, and the symbol itself.
 * A language the engine lacks answers as English does.
 *
 * @example
 * ```ts
 * currencyAffixIn('USD', 'en') // -> { side: 'prefix', symbol: '$' }
 * currencyAffixIn('EUR', 'de') // -> { side: 'suffix', symbol: '€' }
 * ```
 */
export function currencyAffixIn(
  currency: CurrencyCode,
  language: string,
): { side: 'prefix' | 'suffix'; symbol: string } {
  const parts = new Intl.NumberFormat(intlLanguage(language) ?? 'en', {
    style: 'currency',
    currency,
  }).formatToParts(1);
  const at = parts.findIndex((part) => part.type === 'currency');
  return {
    side: at < parts.findIndex((part) => part.type === 'integer') ? 'prefix' : 'suffix',
    symbol: parts[at]?.value ?? currency,
  };
}
