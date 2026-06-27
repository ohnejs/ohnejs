/**
 * Canonicalizes a BCP-47 language tag to its conventional casing via `Intl.getCanonicalLocales`.
 * The language lowercases, the script Title-cases, and the region uppercases, so `de-at` becomes `de-AT`.
 * Returns `null` when `tag` is not a structurally valid language tag.
 *
 * Language tags are case-insensitive, so canonicalizing every tag lets the system compare them with `===`.
 *
 * @example
 * ```ts
 * canonicalizeLanguage('de-at')      // -> 'de-AT'
 * canonicalizeLanguage('EN')         // -> 'en'
 * canonicalizeLanguage('zh-hant-tw') // -> 'zh-Hant-TW'
 * canonicalizeLanguage('en_US')      // -> null
 * canonicalizeLanguage('')           // -> null
 * ```
 */
export function canonicalizeLanguage(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}
