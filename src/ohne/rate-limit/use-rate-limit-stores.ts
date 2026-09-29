import type { RateLimitStore, Registry } from '../../utils/index.ts';

import { createMemoryRateLimitStore, createRegistry, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useConfig } from '../layers/use-config.ts';
import { createDatabaseRateLimitStore } from './create-database-rate-limit-store.ts';

/**
 * Builds a rate-limit store, once per resolved config.
 */
export type RateLimitStoreFactory = () => RateLimitStore;

const registry: Registry<RateLimitStoreFactory> = createRegistry<RateLimitStoreFactory>();

registry.register('memory', () => createMemoryRateLimitStore());

registry.register('database', () => {
  const database = useConfig().api.rateLimitDatabase;
  if (isUndefined(database)) {
    throw ohneError({
      title: 'The `database` rate-limit store needs a helper database',
      body: [
        'Set `api.rateLimitDatabase` to a name from `database.helpers`.',
        'On SQLite, give it its own file, never the main database file.',
      ],
    });
  }
  return createDatabaseRateLimitStore({ database });
});

/**
 * Returns the process-wide rate-limit store registry, keyed by name.
 *
 * ohne registers `memory` and `database`; a boot file registers its own, like a Redis store.
 * `api.rateLimitStore` selects one by name.
 * Registering an existing name overrides it.
 *
 * @example
 * ```ts
 * // boot/rate-limit.ts
 * useRateLimitStores().register('redis', () => createRedisRateLimitStore(redis))
 * ```
 */
export function useRateLimitStores(): Registry<RateLimitStoreFactory> {
  return registry;
}
