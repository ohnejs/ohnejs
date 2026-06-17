import type { Config, ResolvedConfig } from './config.ts';

import { computed, type ComputedRef } from '../../utils/index.ts';
import { useLayers } from './use-layers.ts';

const cached: ComputedRef<Config> = computed(() => useLayers().resolve());

/**
 * Returns the current `ResolvedConfig`, merged from every active layer.
 *
 * Reads inside an `effect` or `computed` re-run when layers change.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Config {
 *     tags: string[]
 *   }
 * }
 *
 * useLayers().add({ path: '/base', defaults: { tags: ['core'] } })
 *
 * useConfig() // -> { tags: ['core'] }
 * ```
 */
export function useConfig(): ResolvedConfig {
  return cached.value;
}
