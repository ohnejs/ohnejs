/**
 * Builds the fallback chain for a BCP-47 language tag, most specific first.
 * Each step drops the trailing `-`-separated subtag.
 *
 * Used to fill a missing message key from a less specific language.
 * A key absent in `de-AT` is looked up in `de`.
 *
 * Subtags are returned verbatim; the tag is not case-normalized.
 * A blank tag yields an empty chain.
 *
 * @example
 * ```ts
 * languageFallbacks('de-AT')      // -> ['de-AT', 'de']
 * languageFallbacks('zh-Hant-TW') // -> ['zh-Hant-TW', 'zh-Hant', 'zh']
 * languageFallbacks('en')         // -> ['en']
 * languageFallbacks('')           // -> []
 * ```
 */
export function languageFallbacks(tag: string): string[] {
  const chain: string[] = [];
  let rest = tag.trim();
  while (rest) {
    chain.push(rest);
    const cut = rest.lastIndexOf('-');
    rest = cut === -1 ? '' : rest.slice(0, cut);
  }
  return chain;
}
