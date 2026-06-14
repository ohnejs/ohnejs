import type { Config } from './config.ts';

import { useLayers } from './use-layers.ts';

/**
 * Returns the resolved `Config`: the closest layer's cumulative resolved view.
 *
 * Backed by the cache in `useLayers()`.
 * Consecutive calls without an `add` or `strategy` change return the same object in O(1).
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
export function useConfig(): Config {
  return useLayers().resolve();
}
