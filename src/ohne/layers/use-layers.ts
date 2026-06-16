import type { Config } from './config.ts';

import { createLayerRegistry, type LayerRegistry } from '../../utils/index.ts';

const registry: LayerRegistry<Config> = createLayerRegistry<Config>();

/**
 * Returns the process-wide layer registry for the ohne `Config`.
 *
 * Use it to register layers and configure `withDefaults` strategies.
 * Inspect the cumulative resolved chain via `layers()` or `resolve()`.
 * Augment `Config` via `declare module 'ohne'` to add typed fields.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Config {
 *     tags: string[]
 *   }
 * }
 *
 * const layers = useLayers()
 *
 * layers.setStrategy('tags', 'concat-unique')
 * layers.add({ path: '/base', defaults: { tags: ['core'] } })
 * layers.add({ path: '/user', input:    { tags: ['custom'] } })
 *
 * layers.resolve() // -> { tags: ['custom', 'core'] }
 * ```
 */
export function useLayers(): LayerRegistry<Config> {
  return registry;
}
