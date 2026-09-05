import type { LayerLoadOptions } from '../project/read-layer-config.ts';

import { merge } from '../../utils/index.ts';
import { resolveLayerStack, type ResolvedLayer } from '../project/resolve-layer-stack.ts';
import { DEFAULTS } from './config.ts';
import { useLayers } from './use-layers.ts';

/**
 * Resolves the layer stack and registers it into `useLayers`, replacing any prior stack.
 *
 * Each layer registers its own `input`, `defaults`, `strategies`, and `codegen`, furthest-first.
 * Closer layers override and the app wins.
 * The framework `DEFAULTS` merge into the furthest layer's own defaults, flooring the whole stack.
 * Any layer is still free to override them.
 *
 * The stack resolves before the registry is cleared, so a config that fails to import never wipes it.
 * The previous stack stays intact, and a later call is a clean reload.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns the registered stack, or `[]` when no `package.json` is found, leaving the registry as-is.
 *
 * Pass `fresh` to re-read every config past the module cache.
 * The dev supervisor reloads with it to pick up edits; a normal boot does not.
 *
 * @example
 * ```ts
 * await loadLayers()
 * useConfig() // -> the config merged from every layer
 * ```
 */
export async function loadLayers(
  from: string = process.cwd(),
  options: LayerLoadOptions = {},
): Promise<ResolvedLayer[]> {
  const stack = await resolveLayerStack(from, options);
  const layers = useLayers();
  if (stack.length > 0) layers.clear();
  stack.forEach((layer, i) => {
    for (const [path, strategy] of Object.entries(layer.strategies)) {
      layers.setStrategy(path, strategy);
    }
    layers.add({
      path: layer.dir,
      name: layer.name,
      input: layer.input,
      defaults: i === 0 ? merge(DEFAULTS, layer.defaults) : layer.defaults,
      codegen: layer.codegen,
    });
  });
  return stack;
}
