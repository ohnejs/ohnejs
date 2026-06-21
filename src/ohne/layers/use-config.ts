import type { Config, ResolvedConfig } from './config.ts';

import { computed, type ComputedRef } from '../../utils/index.ts';
import { useLayers } from './use-layers.ts';

const cached: ComputedRef<Config> = computed(() => useLayers().resolve());

/**
 * Returns the resolved config: the project's `ohne.config.ts` merged with every layer it extends.
 * Defaulted fields are always set; the app and closer layers override the ones beneath them.
 *
 * Read it inside an `effect` or `computed` to re-run when the config changes.
 *
 * @example
 * ```ts
 * useConfig().disable.routes // -> the merged list of route globs to drop
 * useConfig().dirs?.api      // -> 'routes', when the config sets it
 * ```
 */
export function useConfig(): ResolvedConfig {
  return cached.value as ResolvedConfig;
}
