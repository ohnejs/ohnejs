import { first, isNull, negotiateLanguage, vary } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

/**
 * Picks the best response language for the request's `Accept-Language` header from what you offer.
 * Returns the chosen tag, or `undefined` when the client accepts none of them.
 * A request with no `Accept-Language` header accepts any language, so the first offer is returned.
 *
 * Valid only within a request.
 * Negotiation runs `negotiateLanguage` against the live header.
 * `Accept-Language` is appended to the response `Vary` header, since the choice depends on it.
 *
 * @example
 * ```ts
 * // Accept-Language: de-AT, de;q=0.9, en;q=0.5
 * useAcceptsLanguages(['en', 'de']) // -> 'de'
 * ```
 */
export function useAcceptsLanguages(available: readonly string[]): string | undefined {
  const { request, response } = useEvent();
  response.headers.set('vary', vary(response.headers.get('vary') ?? '', 'Accept-Language'));

  const header = request.headers.get('accept-language');
  return isNull(header) ? first(available) : negotiateLanguage(header, available);
}
