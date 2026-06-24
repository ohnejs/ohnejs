import { first, isNull, negotiateLanguage } from '../../utils/index.ts';
import { useRequest } from './use-request.ts';

/**
 * Picks the best response language for the request's `Accept-Language` header from what you offer.
 * Returns the chosen tag, or `undefined` when the client accepts none of them.
 * A request with no `Accept-Language` header accepts any language, so the first offer is returned.
 *
 * Valid only within a request.
 * Negotiation runs `negotiateLanguage` against the live header.
 *
 * @example
 * ```ts
 * // Accept-Language: de-AT, de;q=0.9, en;q=0.5
 * useAcceptsLanguages(['en', 'de']) // -> 'de'
 * ```
 */
export function useAcceptsLanguages(available: readonly string[]): string | undefined {
  const header = useRequest().headers.get('accept-language');
  return isNull(header) ? first(available) : negotiateLanguage(header, available);
}
