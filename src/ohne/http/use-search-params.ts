import type { SearchParamValue } from '../../utils/index.ts';
import type { Event } from './event.ts';

import { isUndefined, parseSearchParams } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

const cache = new WeakMap<Event, { [key: string]: SearchParamValue }>();

/**
 * Returns the request URL's query, parsed into a structured object.
 * Shorthand for `parseSearchParams(useEvent().url.search)`, memoized per request.
 * Valid only within a request.
 *
 * Values carry their own type: `?n=2&ok=true` becomes `{ n: 2, ok: true }`.
 * For the raw `URLSearchParams`, reach `useEvent().url.searchParams`.
 *
 * @example
 * ```ts
 * // GET /search?q=ohne&page=2&tags=[new,sale]
 * useSearchParams() // -> { q: 'ohne', page: 2, tags: ['new', 'sale'] }
 * ```
 */
export function useSearchParams(): { [key: string]: SearchParamValue } {
  const event = useEvent();

  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const parsed = parseSearchParams(event.url.search);
  cache.set(event, parsed);
  return parsed;
}
