import { uniqueArray } from '../array/unique-array.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { languageFallbacks } from './language-fallbacks.ts';
import { messageGroup } from './message-group.ts';

/**
 * One group's messages for `language`, each key from the most specific language down its fallbacks.
 * A key no fallback defines comes from `defaultLanguage`.
 * Each entry names the language its template is written in, for that language's plural rules.
 *
 * @example
 * ```ts
 * const catalogs = { en: { 'nav.go': 'Go', 'nav.back': 'Back' }, de: { 'nav.go': 'Los' } }
 *
 * resolveCatalog(catalogs, 'nav', 'de-AT', 'en')
 * // -> { 'nav.go': { template: 'Los', language: 'de' }, 'nav.back': { template: 'Back', language: 'en' } }
 * ```
 */
export function resolveCatalog(
  catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>,
  group: string,
  language: string,
  defaultLanguage: string,
): Record<string, { template: string; language: string }> {
  const result: Record<string, { template: string; language: string }> = {};
  for (const tag of uniqueArray([...languageFallbacks(language), defaultLanguage]).reverse()) {
    const catalog = catalogs[tag];
    if (isUndefined(catalog)) continue;
    for (const [key, template] of Object.entries(catalog)) {
      if (messageGroup(key) === group) result[key] = { template, language: tag };
    }
  }
  return result;
}
