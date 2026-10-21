import type { CurrencyCode } from './currency-digits.ts';

/**
 * A sum of money as a message parameter: whole minor units of one currency.
 * A plain `{name}` placeholder writes it as the message's language writes money.
 *
 * @example
 * ```ts
 * const min: Amount = { minor: 1234, currency: 'EUR' }
 * formatMessage('At least `{min}`', { min }, 'de') // -> 'At least `12,34 €`'
 * ```
 */
export interface Amount {
  /**
   * The sum in the currency's minor units: `1234` with `EUR` is 12.34 €.
   */
  minor: number;

  /**
   * The ISO 4217 code of the currency.
   */
  currency: CurrencyCode;
}
