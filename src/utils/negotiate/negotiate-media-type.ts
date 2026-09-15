import { type AcceptEntry, parseAccept } from './parse-accept.ts';

/**
 * How closely `range` matches `type/subtype`: `2` exact, `1` for `type/*`, `0` a catch-all, `-1` no match.
 */
function specificity(type: string, subtype: string, range: string): number {
  if (range === '*' || range === '*/*') return 0;
  const slash = range.indexOf('/');
  if (slash === -1) return -1;
  const rangeType = range.slice(0, slash);
  if (rangeType !== type) return -1;
  const rangeSub = range.slice(slash + 1);
  if (rangeSub === '*') return 1;
  return rangeSub === subtype ? 2 : -1;
}

/**
 * The `q` of the most specific range matching `offer`, or `0` when no range matches.
 */
function qualityOf(offer: string, ranges: AcceptEntry[]): number {
  const slash = offer.indexOf('/');
  const type = offer.slice(0, slash);
  const subtype = offer.slice(slash + 1);

  let best = -1;
  let q = 0;
  for (const range of ranges) {
    const spec = specificity(type, subtype, range.value);
    if (spec > best) {
      best = spec;
      q = range.q;
    }
  }
  return q;
}

/**
 * Picks the best media type from an `Accept` header against what the server can produce.
 * Returns the chosen `available` entry (original casing) or `undefined` when nothing is acceptable.
 *
 * The server's offers drive the choice: each offer is scored by its most specific matching range.
 * Exact `type/subtype` beats `type/*` beats the catch-all `*`; that range's quality is the offer's weight.
 * The highest-weighted offer wins, ties keeping the server's `available` order.
 * A `q=0` range refuses the offer even when a broader range would allow it.
 * An unmatched or refused offer never wins.
 *
 * Matching is case-insensitive; media-type parameters other than `q` are ignored.
 *
 * @example
 * ```ts
 * negotiateMediaType('text/html, application/json;q=0.9', ['application/json'])
 * // -> 'application/json'
 *
 * negotiateMediaType('text/*', ['text/plain', 'application/json'])
 * // -> 'text/plain'
 *
 * negotiateMediaType('image/png', ['text/html'])
 * // -> undefined
 * ```
 */
export function negotiateMediaType(
  header: string,
  available: readonly string[],
): string | undefined {
  const ranges = parseAccept(header);

  let best: string | undefined;
  let bestQ = 0;
  for (const offer of available) {
    const q = qualityOf(offer.toLowerCase(), ranges);
    if (q > bestQ) {
      bestQ = q;
      best = offer;
    }
  }
  return best;
}
