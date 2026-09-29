import type { RateLimitStore } from '../../utils/index.ts';

import { resolveRateLimitStore } from './_resolve-rate-limit-store.ts';

const store: RateLimitStore = {
  take: (key, rate) => resolveRateLimitStore().take(key, rate),
  reset: (key) => resolveRateLimitStore().reset(key),
};

/**
 * Returns the app's rate-limit store, the one `api.rateLimitStore` selects.
 * It looks the selected store up on every call, so it is safe to hold at module scope.
 * Pass it to `createRateLimiter` to count where route limits and sign-in count.
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({ name: 'exports', limit: 5, window: '1h', store: useRateLimitStore() })
 * ```
 */
export function useRateLimitStore(): RateLimitStore {
  return store;
}
