import { enforceRateLimit, useConfig, useRateLimitStore } from 'ohnejs';
import { createRateLimiter, isUndefined, type RateLimiter } from 'ohnejs/utils';

import { useAuthConfig } from './config.ts';

const limiters = new WeakMap<object, RateLimiter | false>();

/**
 * Returns the limiter `auth.loginRateLimit` declares, or `false` when sign-in is unlimited.
 * It counts in the app's rate-limit store, built once per resolved config.
 */
export function loginRateLimiter(): RateLimiter | false {
  const config = useConfig();
  let limiter = limiters.get(config);
  if (isUndefined(limiter)) {
    const { loginRateLimit } = useAuthConfig();
    limiter =
      loginRateLimit === false
        ? false
        : createRateLimiter({ ...loginRateLimit, name: 'ohne:login', store: useRateLimitStore() });
    limiters.set(config, limiter);
  }
  return limiter;
}

/**
 * Counts one sign-in attempt against the client's network, and answers `429` past `auth.loginRateLimit`.
 */
export async function enforceLoginRateLimit(): Promise<void> {
  const limiter = loginRateLimiter();
  if (limiter !== false) await enforceRateLimit(limiter);
}
