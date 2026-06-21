import { resolveLayerStack, type ResolvedLayer } from '../project/resolve-layer-stack.ts';
import { useLayers } from './use-layers.ts';

/**
 * Resolves the layer stack and registers every layer into `useLayers`.
 *
 * Each layer's own config is added as its `input` - the author's values for that layer.
 * Layers register furthest-first, so closer layers override and the app wins.
 *
 * Run this once before codegen, so `useConfig` returns a resolved config to the generators.
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
  for (const layer of stack) {
    layers.add({ path: layer.dir, input: layer.config });
  }
  return stack;
}
