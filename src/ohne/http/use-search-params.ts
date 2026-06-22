import { useEvent } from './use-event.ts';

/**
 * Returns the request URL's query as the real `URLSearchParams`.
 * Shorthand for `useEvent().url.searchParams`; valid only within a request.
 *
 * The name `query` stays reserved for the database layer, so this is `useSearchParams`.
 *
 * @example
 * ```ts
 * // GET /search?q=ohne&page=2
 * useSearchParams().get('q')    // -> 'ohne'
 * useSearchParams().get('page') // -> '2'
 * ```
 */
export function useSearchParams(): URLSearchParams {
  return useEvent().url.searchParams;
}
