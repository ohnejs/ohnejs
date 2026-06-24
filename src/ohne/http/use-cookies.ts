import type { Event } from './event.ts';

import { isUndefined, parseCookies } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

const cache = new WeakMap<Event, Record<string, string>>();

/**
 * Returns the request's cookies, parsed into a map of name to value.
 * Shorthand for `parseCookies(useEvent().request.headers.get('cookie'))`, memoized per request.
 * Valid only within a request.
 *
 * To set or clear cookies, use `setCookie` and `deleteCookie`.
 *
 * @example
 * ```ts
 * // Cookie: id=42; theme=dark
 * useCookies() // -> { id: '42', theme: 'dark' }
 * ```
 */
export function useCookies(): Record<string, string> {
  const event = useEvent();

  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const parsed = parseCookies(event.request.headers.get('cookie') ?? '');
  cache.set(event, parsed);
  return parsed;
}
