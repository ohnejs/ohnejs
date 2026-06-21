import type { Config } from '../layers/config.ts';

import { isUndefined, last } from '../../utils/index.ts';
import { readLayerConfig } from './read-layer-config.ts';
import { type OhneLayer, resolveOhneLayers } from './resolve-ohne-layers.ts';

/**
 * A layer in the resolved stack, paired with its own config.
 */
export interface ResolvedLayer extends OhneLayer {
  /**
   * The layer's own config: the default export of its `ohne.config.ts`, before any merge.
   */
  config: Config;
}

/**
 * Resolves the ordered layer stack for the app by cascading the `layers` config.
 *
 * The app's `layers` name the layers it extends; each of those names its own, and so on.
 * Only the layers reached this way are stacked - an installed layer no one lists is left out.
 * Names resolve to directories through `resolveOhneLayers`, the app's ohne dependency closure.
 *
 * The graph is walked depth-first in post-order, so a layer is emitted before the layers that list it.
 * A layer shared by several entries is emitted once, ahead of them all.
 * Within one layer's `layers`, declaration order holds, with the later entry winning.
 * The app itself is the root and comes last; later overrides earlier everywhere.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveLayerStack()
 * // -> [
 * //      { name: 'ohne', dir: '...', config: {} },
 * //      { name: '@acme/base', dir: '...', config: { layers: ['ohne'] } },
 * //      { name: '@acme/auth', dir: '...', config: { layers: ['@acme/base'] } },
 * //      { name: 'app', dir: '...', config: { layers: ['@acme/auth'] } },
 * //    ]
 * ```
 */
export async function resolveLayerStack(from: string = process.cwd()): Promise<ResolvedLayer[]> {
  const closure = await resolveOhneLayers(from);
  if (closure.length === 0) return [];

  const dirByName = new Map(closure.map((layer) => [layer.name, layer.dir]));
  const stack: ResolvedLayer[] = [];
  const visited = new Set<string>();

  await walk(last(closure)!);
  return stack;

  async function walk(layer: OhneLayer): Promise<void> {
    if (visited.has(layer.dir)) return;
    visited.add(layer.dir);

    const config = (await readLayerConfig(layer.dir)) ?? {};
    for (const name of config.layers ?? []) {
      const dir = dirByName.get(name);
      if (isUndefined(dir)) continue;
      await walk({ name, dir });
    }
    stack.push({ ...layer, config });
  }
}
