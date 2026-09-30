import { isUndefined } from '../is/is-undefined.ts';
import { getOrSet } from '../map/get-or-set.ts';
import { languageFallbacks } from './language-fallbacks.ts';

const resolved = new Map<string, string | null>();
const EXTENSION = /-[a-wyz0-9]-|-x-/i;

/**
 * The tag `Intl` formats `language` with: the most specific entry of its fallback chain that has real data.
 * The probe skips extensions like `-u-ca-chinese`, which a language keeps whenever its base has data.
 * An engine may list a language it has no data for, and then format with CLDR root placeholders like `M09`.
 * Returns `undefined` when no entry has data, so `Intl` falls back to the engine's default language.
 *
 * @example
 * ```ts
 * intlLanguage('de-AT') // -> 'de-AT'
 * intlLanguage('bs')    // -> 'bs', or undefined in a browser without Bosnian data
 * ```
 */
export function intlLanguage(language: string): string | undefined {
  const tag = getOrSet(resolved, language, () => {
    const base = language.split(EXTENSION, 1)[0];
    const found = languageFallbacks(base).find(hasData);
    return isUndefined(found) ? null : found === base ? language : found;
  });
  return tag ?? undefined;
}

/**
 * Whether `Intl` formats `tag` with its own data rather than CLDR root placeholders.
 */
function hasData(tag: string): boolean {
  const month = new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' });
  return !/^M\d{2}$/.test(month.format(Date.UTC(2024, 8, 1)));
}
