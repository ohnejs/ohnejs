import { type AcceptEntry, parseAccept } from './parse-accept.ts';

/**
 * Picks the best language tag from an `Accept-Language` header against what the server offers.
 * Returns the chosen `available` entry (original casing) or `undefined` when nothing overlaps.
 *
 * Selection follows RFC 4647 lookup with RFC 9110 quality weights:
 *
 * - Each offer takes the quality of its most specific matching range, so `en;q=0` refuses `en`.
 * - A range matches a tag exactly, then by truncation: `zh-Hant-TW` matches an offered `zh-Hant`, then `zh`.
 *   The range only narrows toward the offer, so `en` never matches an offered `en-US`.
 * - `*` matches any tag not matched by another range; an offer it covers takes the `*` weight.
 * - The highest-weighted offer wins; ties go to the more specific offer, then to `available` order.
 *
 * Matching is case-insensitive.
 * Applying a default locale is the caller's job.
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
  const ranges = parseAccept(header);

  let best: string | undefined;
  let bestQ = 0;
  let bestSpec = -1;
  for (const offer of available) {
    const lower = offer.toLowerCase();
    const q = qualityOf(lower, ranges);
    const spec = lower.split('-').length;
    if (q > 0 && (q > bestQ || (q === bestQ && spec > bestSpec))) {
      best = offer;
      bestQ = q;
      bestSpec = spec;
    }
  }
  return best;
}

function qualityOf(offer: string, ranges: AcceptEntry[]): number {
  let best = -1;
  let q = 0;
  for (const range of ranges) {
    const spec = specificity(offer, range.value);
    if (spec > best) {
      best = spec;
      q = range.q;
    }
  }
  return q;
}

function specificity(offer: string, range: string): number {
  if (range === '*') return 0;
  if (offer === range) return 2;
  if (range.startsWith(`${offer}-`)) return 1;
  return -1;
}
