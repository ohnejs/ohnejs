import { isIPv6 } from 'node:net';

import type { RateLimiter } from '../../utils/index.ts';

import { isEmpty } from '../../utils/index.ts';
import { ipPrefix } from '../../utils/net/index.ts';
import { tooManyRequests } from './http-error.ts';
import { useEvent } from './use-event.ts';
import { useResponse } from './use-response.ts';

/**
 * Counts one hit of the current request against `limiter`, and answers `429` past its budget.
 * The `429` carries `Retry-After`, the whole seconds until the next hit is allowed.
 * Works in a handler or a named middleware; valid only within a request.
 *
 * `key` names who is counted, by default the client's IP, or its `/64` for an IPv6 client.
 * An empty key is never limited, so a request without a known IP always passes.
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({ name: 'exports', limit: 5, window: '1h', store: useRateLimitStore() })
 *
 * export default defineHandler(async () => {
 *   const user = await requireUser()
 *   await enforceRateLimit(limiter, user.UUID)
 *   return exportAll(user)
 * })
 * ```
 */
export async function enforceRateLimit(
  limiter: RateLimiter,
  key: string = clientNetwork(useEvent().ip),
): Promise<void> {
  if (isEmpty(key)) return;
  const wait = await limiter.hit(key);
  if (wait === 0) return;
  useResponse().headers.set('Retry-After', String(Math.ceil(wait / 1000)));
  throw tooManyRequests();
}

/**
 * The key a client IP is counted under: its `/64` for IPv6, the address itself otherwise.
 */
function clientNetwork(ip: string): string {
  return isIPv6(ip) ? ipPrefix(ip, 64) : ip;
}
