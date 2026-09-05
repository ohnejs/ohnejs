import type { Config } from './config.ts';
import type { LayerCodegen } from './define-layer.ts';

import { createLayerRegistry, type LayerRegistry } from '../../utils/index.ts';
import { BASE_STRATEGIES } from './config.ts';

/**
 * What a registered layer carries besides its config.
 * `loadLayers` fills it from each layer's `ohne.layer.ts`; a layer added by hand may leave it out.
 */
export interface LayerExtras {
  /**
   * Files the layer generates into the app's codegen directory.
   * `generateLayerCodegen` writes them once the stack has loaded.
   */
  codegen?: LayerCodegen[];
}

const registry: LayerRegistry<Config, LayerExtras> = createLayerRegistry<Config, LayerExtras>({
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
 * Each layer also carries `LayerExtras`: the `codegen` its `ohne.layer.ts` declares.
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
export function useLayers(): LayerRegistry<Config, LayerExtras> {
  return registry;
}
