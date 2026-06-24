import { first, isNull, negotiateMediaType } from '../../utils/index.ts';
import { useRequest } from './use-request.ts';

/**
 * Picks the best response media type for the request's `Accept` header from what you can produce.
 * Returns the chosen offer, or `undefined` when the client accepts none of them (answer `406`).
 * A request with no `Accept` header accepts anything, so the first offer is returned.
 *
 * Valid only within a request.
 * Negotiation runs `negotiateMediaType` against the live header.
 *
 * @example
 * ```ts
 * // Accept: text/html, application/json;q=0.9
 * useAccepts(['application/json', 'text/html']) // -> 'text/html'
 * ```
 */
export function useAccepts(available: readonly string[]): string | undefined {
  const header = useRequest().headers.get('accept');
  return isNull(header) ? first(available) : negotiateMediaType(header, available);
}
