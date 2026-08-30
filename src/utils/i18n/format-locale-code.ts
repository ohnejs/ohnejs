import { isUndefined } from '../is/is-undefined.ts';

/**
 * Formats a locale code for compact display: the language uppercased, the region in parentheses.
 * The second subtag renders as the region; any later subtag never renders.
 *
 * @example
 * ```ts
 * formatLocaleCode('en')    // -> 'EN'
 * formatLocaleCode('de-AT') // -> 'DE (AT)'
 * ```
 */
export function formatLocaleCode(code: string): string {
  const [language = '', region] = code.split('-');
  return isUndefined(region)
    ? language.toUpperCase()
    : `${language.toUpperCase()} (${region.toUpperCase()})`;
}
