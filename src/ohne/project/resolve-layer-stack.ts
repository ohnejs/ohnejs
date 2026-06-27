import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from '../layers/config.ts';

import { resolveModuleDir } from '../../utils/fs/index.ts';
import { isNull, isUndefined, last } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { type LayerLoadOptions, readLayerConfig } from './read-layer-config.ts';
import { type OhneLayer, resolveOhneLayers } from './resolve-ohne-layers.ts';

/**
 * A layer in the resolved stack, paired with its own config, split by ownership.
 */
export interface ResolvedLayer extends OhneLayer {
  /**
   * Values the layer sets, from its `ohne.config.ts`.
   */
  input: Config;

  /**
   * Default values the layer owns, from its `ohne.layer.ts`, or `{}` when it ships none.
   */
  defaults: Config;

  /**
   * Merge strategies the layer owns, from its `ohne.layer.ts`, or `{}` when it ships none.
   */
  strategies: LayerStrategies;
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
 * Throws when a listed layer cannot be used: not installed, or installed without an `ohne.config.ts`.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns `[]` when no `package.json` is found.
 *
 * Pass `fresh` to re-read every config past the module cache, so edits are seen again.
 *
 * @example
 * ```ts
 * const stack = await resolveLayerStack()
 *
 * stack.map((layer) => layer.name)
 * // -> ['ohne', '@acme/base', '@acme/auth', 'app']
 * ```
 */
export async function resolveLayerStack(
  from: string = process.cwd(),
  options: LayerLoadOptions = {},
): Promise<ResolvedLayer[]> {
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

    const config = (await readLayerConfig(layer.dir, options)) ?? {
      input: {},
      defaults: {},
      strategies: {},
    };
    for (const name of config.input.layers ?? []) {
      const dir = dirByName.get(name);
      if (isUndefined(dir)) {
        const resolved = await resolveModuleDir(name, layer.dir);
        const detail = isNull(resolved)
          ? `\`${name}\` is not installed.`
          : `\`${name}\` has no \`ohne.config.ts\` (resolved to \`${resolved}\`).`;
        throw ohneError({
          title: `Layer \`${name}\` cannot be used`,
          body: [detail, `It is listed by \`${layer.name}\`.`],
        });
      }
      await walk({ name, dir });
    }
    stack.push({ ...layer, ...config });
  }
}
