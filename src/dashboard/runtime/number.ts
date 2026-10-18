import type { CurrencyCode } from '../../utils/i18n/currency-digits.ts';

import { currencyDigits } from '../../utils/i18n/currency-digits.ts';
import { formatNumberIn } from '../../utils/i18n/format-number-in.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

/**
 * Options for `formatNumber`.
 */
export interface NumberFormatOptions {
  /**
   * Shortens a large number to a unit, like `12.9K` or `4.2M`, with at most one decimal.
   *
   * @default
   * false
   */
  compact?: boolean;

  /**
   * An ISO 4217 code that formats the number as an amount of that currency, like `'EUR'`.
   * The number is in major units, with the currency's ISO 4217 digits unless `decimals` is set.
   */
  currency?: CurrencyCode;

  /**
   * Reads the number as a ratio and writes it as a percentage, so `0.25` is `25%`.
   *
   * @default
   * false
   */
  percent?: boolean;

  /**
   * The exact count of decimals.
   * Omitted keeps the language's own rounding, or one decimal at most when `compact`.
   */
  decimals?: number;

  /**
   * Leads a positive number with `+`, as a change reads; zero stays unsigned.
   *
   * @default
   * false
   */
  signed?: boolean;
}

/**
 * Formats a number in the dashboard language, read reactively so a binding follows a language switch.
 * A language the browser has no data for still gets its own separators from the server's `Intl` data.
 * Use `compact` for headline tiles and axes, the full number in tables and tooltips.
 *
 * @example
 * ```ts
 * // With `en` as the dashboard language
 * formatNumber(12904)                                       // -> '12,904'
 * formatNumber(12904, { compact: true })                    // -> '12.9K'
 * formatNumber(1290000, { currency: 'EUR', compact: true }) // -> '€1.3M'
 * formatNumber(0.042, { percent: true, decimals: 1 })       // -> '4.2%'
 * formatNumber(0.23, { percent: true, signed: true })       // -> '+23%'
 * ```
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const { compact = false, currency, percent = false, signed = false } = options;
  const decimals =
    options.decimals ?? (isUndefined(currency) || compact ? undefined : currencyDigits[currency]);
  return formatNumberIn(value, useDashboardLanguage().value, {
    style: isUndefined(currency) ? (percent ? 'percent' : 'decimal') : 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: compact ? (decimals ?? 0) : decimals,
    maximumFractionDigits: compact ? (decimals ?? 1) : decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });
}
