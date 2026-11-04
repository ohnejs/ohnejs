import type { CurrencyCode } from '../../utils/i18n/currency-digits.ts';

import { byteExponent } from '../../utils/bytes/byte-exponent.ts';
import { currencyDigits } from '../../utils/i18n/currency-digits.ts';
import { formatNumberIn } from '../../utils/i18n/format-number-in.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

/**
 * The units a byte count writes in, the one at index `n` holding `1024 ** n` bytes.
 */
export const BYTE_UNITS = [
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'terabyte',
  'petabyte',
] as const;

/**
 * A unit `formatNumber` can write a byte count in, each 1024 times the one before.
 */
export type ByteUnit = (typeof BYTE_UNITS)[number];

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
   * Reads the number as a byte count and writes it in the unit that suits its size, like `7.8 GB`.
   * A unit name pins that unit, so a column or an axis reads in one.
   *
   * @default
   * false
   */
  bytes?: boolean | ByteUnit;

  /**
   * The exact count of decimals.
   * Omitted keeps the language's own rounding, or one decimal at most when `compact` or `bytes`.
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
 * formatNumber(8_400_000_000, { bytes: true })              // -> '7.8 GB'
 * ```
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const { bytes = false, compact = false, currency, percent = false, signed = false } = options;
  const signDisplay = signed ? 'exceptZero' : 'auto';
  if (bytes !== false) {
    const unit =
      bytes === true ? BYTE_UNITS[byteExponent(Math.abs(value), options.decimals ?? 1)]! : bytes;
    return formatNumberIn(value / 1024 ** BYTE_UNITS.indexOf(unit), useDashboardLanguage().value, {
      style: 'unit',
      unit,
      // The short `byte` reads `512 byte` in English; the long form is `512 bytes`.
      unitDisplay: unit === 'byte' ? 'long' : 'short',
      minimumFractionDigits: options.decimals,
      maximumFractionDigits: options.decimals ?? 1,
      signDisplay,
    });
  }
  const decimals =
    options.decimals ?? (isUndefined(currency) || compact ? undefined : currencyDigits[currency]);
  return formatNumberIn(value, useDashboardLanguage().value, {
    style: isUndefined(currency) ? (percent ? 'percent' : 'decimal') : 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: compact ? (decimals ?? 0) : decimals,
    maximumFractionDigits: compact ? (decimals ?? 1) : decimals,
    signDisplay,
  });
}
