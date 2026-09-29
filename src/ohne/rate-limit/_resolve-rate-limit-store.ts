import type { RateLimitStore } from '../../utils/index.ts';

import { isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { DEFAULT_RATE_LIMIT_STORE } from '../layers/config.ts';
import { useConfig } from '../layers/use-config.ts';
import { useRateLimitStores } from './use-rate-limit-stores.ts';

const stores = new WeakMap<object, RateLimitStore>();

/**
 * Returns the store `api.rateLimitStore` selects, built once per resolved config.
 * Throws when it names a store nothing registered.
 */
export function resolveRateLimitStore(): RateLimitStore {
  const config = useConfig();
  const cached = stores.get(config);
  if (!isUndefined(cached)) return cached;

  const name = config.api.rateLimitStore ?? DEFAULT_RATE_LIMIT_STORE;
  const factory = useRateLimitStores().get(name);
  if (isUndefined(factory)) {
    throw ohneError({
      title: `Unknown rate-limit store \`${name}\``,
      body: [
        '`api.rateLimitStore` names a store nothing registered.',
        'ohne ships `memory` and `database`; a boot file registers its own with `useRateLimitStores()`.',
      ],
    });
  }
  const store = factory();
  stores.set(config, store);
  return store;
}

/**
 * Closes the current config's rate-limit store, when one was built.
 */
export async function closeRateLimitStore(): Promise<void> {
  await stores.get(useConfig())?.close?.();
}
