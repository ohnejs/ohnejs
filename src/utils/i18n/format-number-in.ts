import { isUndefined } from '../is/is-undefined.ts';
import { intlData } from './intl-data.ts';
import { intlLanguage } from './intl-language.ts';

/**
 * Formats a number the way `language` writes it.
 * A decimal string formats exactly, past what a double holds.
 * A language the engine lacks formats in English, its separators swapped for the registered `IntlData`'s.
 * The read of the registry is reactive, so a binding re-renders once that data arrives.
 *
 * @example
 * ```ts
 * formatNumberIn(12345.6, 'en')                    // -> '12,345.6'
 * formatNumberIn(12345.6, 'de')                    // -> '12.345,6'
 * formatNumberIn(0.25, 'en', { style: 'percent' }) // -> '25%'
 * formatNumberIn('90071992547409.91', 'en')        // -> '90,071,992,547,409.91'
 * ```
 */
export function formatNumberIn(
  value: number | bigint | `${number}`,
  language: string,
  options?: Intl.NumberFormatOptions,
): string {
  const tag = intlLanguage(language);
  const separators = isUndefined(tag) ? intlData(language)?.number : undefined;
  const format = new Intl.NumberFormat(isUndefined(separators) ? tag : 'en', options);
  if (isUndefined(separators)) return format.format(value);
  return format
    .formatToParts(value)
    .map(({ type, value: text }) =>
      type === 'group' ? separators.group : type === 'decimal' ? separators.decimal : text,
    )
    .join('');
}
