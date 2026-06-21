import type { Config } from './config.ts';

import { createLayerRegistry, type LayerRegistry } from '../../utils/index.ts';
import { BASE_STRATEGIES } from './config.ts';

const registry: LayerRegistry<Config> = createLayerRegistry<Config>({
  strategies: BASE_STRATEGIES,
});

/**
 * Returns the process-wide layer registry for the ohne `Config`.
 * Layers load automatically from each project's config; most code reads the merge via `useConfig`.
 * This is the low-level handle for inspecting or driving the stack directly.
 *
 * Layers stack in registration order.
 * Later layers override earlier ones; earlier layers fill in what's missing.
 * Add a layer with `add`, read the merged config with `resolve`, walk the stack with `layers`.
 *
 * Merge: plain objects combine per key; arrays and other values are replaced by the later layer.
 * Override per-field via `setStrategy`; the framework seeds `BASE_STRATEGIES` at creation.
 *
 * Extend the typed shape via `declare module 'ohne'`.
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
