import { type CurrencyCode, currencyDigits } from './currency-digits.ts';

/**
 * Every circulating ISO 4217 currency code, sorted, as `currencyDigits` keys them.
 *
 * @example
 * ```ts
 * currencyCodes.includes('EUR') // -> true
 * currencyCodes.includes('XAU') // -> false
 * ```
 */
export const currencyCodes: readonly CurrencyCode[] = Object.keys(currencyDigits) as CurrencyCode[];
