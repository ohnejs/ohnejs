import { parseAccept } from './parse-accept.ts';

/**
 * Picks the best language tag from an `Accept-Language` header against what the server offers.
 * Returns the chosen `available` entry (original casing) or `undefined` when nothing overlaps.
 *
 * Selection follows RFC 4647 lookup, in the client's preference order:
 *
 * - Tags are tried by quality descending; `q=0` is explicitly refused and skipped.
 * - A tag matches exactly, then by truncation: `zh-Hant-TW` falls back to `zh-Hant`, then `zh`.
 *   The range only narrows toward the offer, so `en` never matches an offered `en-US`.
 * - `*` (with `q > 0`) accepts anything, resolving to the server's first offer.
 *
 * Matching is case-insensitive. Applying a default locale is the caller's job.
 *
 * @example
 * ```ts
 * negotiateLanguage('de-AT, de;q=0.9, en;q=0.5', ['en', 'de']) // -> 'de'
 * negotiateLanguage('fr-FR', ['en', 'de'])                     // -> undefined
 * negotiateLanguage('*', ['en', 'de'])                         // -> 'en'
 * ```
 */
export function negotiateLanguage(
  header: string,
  available: readonly string[],
): string | undefined {
  const lookup = new Map<string, string>();
  for (const tag of available) lookup.set(tag.toLowerCase(), tag);

  for (const { value, q } of parseAccept(header)) {
    if (q === 0) continue;
    if (value === '*') return available[0];

    let range = value;
    for (;;) {
      const hit = lookup.get(range);
      if (hit) return hit;
      const cut = range.lastIndexOf('-');
      if (cut === -1) break;
      range = range.slice(0, cut);
    }
  }
  return undefined;
}
