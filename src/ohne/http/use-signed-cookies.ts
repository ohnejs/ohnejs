import type { Event } from './event.ts';

import { unsignValue } from '../../utils/crypto/index.ts';
import { isNull, isUndefined } from '../../utils/index.ts';
import { cookieSecrets } from './_cookie-secret.ts';
import { useCookies } from './use-cookies.ts';
import { useEvent } from './use-event.ts';

const cache = new WeakMap<Event, Record<string, string>>();

/**
 * Returns the request's signed cookies, verified and recovered into a map of name to value.
 * Each value is verified against the `COOKIE_SECRET`, bound to its own name, and memoized per request.
 * Valid only within a request.
 *
 * Only cookies with a valid signature appear; tampered, unsigned, and renamed ones are dropped.
 * To set them, use `setSignedCookie`.
 * For raw, unverified cookies, use `useCookies`.
 *
 * @example
 * ```ts
 * // Cookie: session=u42.<tag>
 * useSignedCookies() // -> { session: 'u42' }
 * ```
 */
export function useSignedCookies(): Record<string, string> {
  const event = useEvent();

  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const secrets = cookieSecrets();
  const verified: Record<string, string> = {};
  for (const [name, raw] of Object.entries(useCookies())) {
    for (const secret of secrets) {
      const value = unsignValue(raw, secret, name);
      if (!isNull(value)) {
        verified[name] = value;
        break;
      }
    }
  }

  cache.set(event, verified);
  return verified;
}
