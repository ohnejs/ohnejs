import { merge } from '../../utils/index.ts';
import { resolveLayerStack, type ResolvedLayer } from '../project/resolve-layer-stack.ts';
import { DEFAULTS } from './config.ts';
import { useLayers } from './use-layers.ts';

/**
 * Resolves the layer stack and registers every layer into `useLayers`.
 *
 * Each layer registers its own `input`, `defaults`, and `strategies`, furthest-first.
 * Closer layers override and the app wins.
 * The framework `DEFAULTS` merge into the furthest layer's own defaults, flooring the whole stack.
 * Any layer is still free to override them.
 *
 * Run this once before reading config, so `useConfig` resolves with every layer in place.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns the registered stack, or `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await loadLayers()
 * useConfig() // -> the config merged from every layer
 * ```
 */
export async function loadLayers(from: string = process.cwd()): Promise<ResolvedLayer[]> {
  const stack = await resolveLayerStack(from);
  const layers = useLayers();
  stack.forEach((layer, i) => {
    for (const [path, strategy] of Object.entries(layer.strategies)) {
      layers.setStrategy(path, strategy);
    }
    layers.add({
      path: layer.dir,
      input: layer.input,
      defaults: i === 0 ? merge(DEFAULTS, layer.defaults) : layer.defaults,
    });
  });
  return stack;
}
