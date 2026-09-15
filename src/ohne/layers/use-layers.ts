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
 * Returns the process-wide layer registry for the ohne `Config`, seeded with `BASE_STRATEGIES`.
 * Layers load automatically from each project's config; most code reads the merge via `useConfig`.
 * This is the low-level handle for inspecting or driving the stack directly.
 *
 * Later layers override earlier ones: plain objects combine per key, arrays and other values are replaced.
 * Each layer also carries `LayerExtras`: the `codegen` its `ohne.layer.ts` declares.
 *
 * @example
 * ```ts
 * declare module 'ohnejs' {
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
