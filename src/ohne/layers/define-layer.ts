import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from './config.ts';

export type { LayerStrategies } from '../../utils/index.ts';

/**
 * What a layer contributes when it introduces new config keys.
 * Both fields target the keys the layer declares; its own values still live in `ohne.config.ts`.
 */
export interface LayerDefinition {
  /**
   * Default values for the keys this layer introduces.
   * Floors the stack: filled wherever no project sets the key, never overriding one that does.
   *
   * @default
   * {}
   */
  defaults?: Config;

  /**
   * Merge strategies for the keys this layer introduces, keyed by dot-notation path.
   *
   * - `'replace'` - the closer layer wins entirely; lower layers are discarded.
   * - `'defaults'` - recurse into objects per key and arrays per index; the longer side fills the rest.
   * - `'concat'` - arrays only: the closer layer's items first, then the lower layers'.
   * - `'concat-unique'` - same as `'concat'`, then duplicates are dropped.
   *
   * @default
   * {}
   *
   * @example
   * ```ts
   * strategies: {
   *   'myFeature.tags': 'concat-unique',
   * }
   * ```
   */
  strategies?: LayerStrategies;
}

/**
 * Defines a layer's owned config: the `defaults` and `strategies` for the keys it introduces.
 * The default export of an optional `ohne.layer.ts`, present only when a layer adds keys.
 *
 * Declare the keys by augmenting `Config` first, then describe their defaults and merge below.
 * A layer's own values still belong in its `ohne.config.ts` via `defineConfig`.
 *
 * @example
 * ```ts
 * declare module 'ohne' {
 *   interface Config {
 *     myFeature: { ttl: number; tags: string[] }
 *   }
 * }
 *
 * export default defineLayer({
 *   defaults: { myFeature: { ttl: 3600, tags: [] } },
 *   strategies: { 'myFeature.tags': 'concat-unique' },
 * })
 * ```
 */
export function defineLayer(layer: LayerDefinition): LayerDefinition {
  return layer;
}
