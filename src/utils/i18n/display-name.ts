import { capitalize } from '../case/capitalize.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { getOrSet } from '../map/get-or-set.ts';
import { intlData } from './intl-data.ts';
import { intlLanguage } from './intl-language.ts';

const formats = new Map<string, Intl.DisplayNames>();

/**
 * The name `language` gives a language, country, or currency code, capitalized to stand on its own.
 * A country or currency the engine cannot name in `language` reads from the registered `IntlData`.
 * A code nothing names, or a malformed one, comes back unchanged.
 *
 * @example
 * ```ts
 * displayName('DE', 'region', 'de')   // -> 'Deutschland'
 * displayName('EUR', 'currency', 'fr') // -> 'Euro'
 * displayName('bs', 'language', 'bs')  // -> 'Bosanski'
 * displayName('QQ', 'region', 'en')    // -> 'QQ'
 * ```
 */
export function displayName(
  code: string,
  kind: 'language' | 'region' | 'currency',
  language: string,
): string {
  try {
    // An engine can hold a language's names but not its dates, as Chrome does for Bosnian.
    const tag = kind === 'language' ? language : intlLanguage(language);
    const stored =
      isUndefined(tag) && kind !== 'language' ? intlData(language)?.names[kind] : undefined;
    const names = getOrSet(
      formats,
      `${tag ?? ''} ${kind}`,
      () => new Intl.DisplayNames(tag, { type: kind, fallback: 'none' }),
    );
    const name =
      !isUndefined(stored) && Object.hasOwn(stored, code) ? stored[code] : names.of(code);
    return isUndefined(name) ? code : capitalize(name);
  } catch {
    return code;
  }
}
