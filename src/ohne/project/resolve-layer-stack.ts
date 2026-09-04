import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from '../layers/config.ts';

import { isNull, isUndefined, last, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { isOhneProject } from './is-ohne-project.ts';
import { type LayerLoadOptions, readLayerConfig } from './read-layer-config.ts';
import { parseLayerSpecifier, resolveLayerDir, resolveLayerSubpath } from './resolve-layer-dir.ts';
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
 * A name carrying a subpath (`@acme/kit/auth`) resolves through the package's `exports`.
 * The package may already be in the closure, the app itself included.
 * An app can therefore list a layer its own `package.json` exports.
 *
 * The graph is walked depth-first in post-order, so a layer is emitted before the layers that list it.
 * A layer shared by several entries is emitted once, ahead of them all.
 * Within one layer's `layers`, declaration order holds, with the later entry winning.
 * The app itself is the root and comes last; later overrides earlier everywhere.
 *
 * Throws when a listed layer cannot be used.
 * The name is not installed, its subpath is not exported, or the directory has no `ohne.config.ts`.
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
    for (const specifier of config.input.layers ?? []) {
      const { name, subpath } = parseLayerSpecifier(specifier);
      const root = dirByName.get(name);
      const dir = isUndefined(root)
        ? await resolveLayerDir(specifier, layer.dir)
        : await resolveLayerSubpath(root, subpath);
      if (isNull(dir)) {
        throw ohneError({
          title: `Layer \`${specifier}\` cannot be used`,
          body: [
            `\`${specifier}\` is not installed, or its package does not export it as a layer.`,
            `It is listed by \`${layer.name}\`.`,
          ],
        });
      }
      if (dir !== root && !(await isOhneProject(dir))) {
        throw ohneError({
          title: `Layer \`${specifier}\` cannot be used`,
          body: [
            `\`${specifier}\` resolved to \`${relativePath(process.cwd(), dir)}\`, which has no \`ohne.config.ts\`.`,
            `It is listed by \`${layer.name}\`.`,
          ],
        });
      }
      await walk({ name: specifier, dir });
    }
    stack.push({ ...layer, ...config });
  }
}
