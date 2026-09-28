import type { LayerStrategies } from '../../utils/index.ts';
import type { Config } from '../layers/config.ts';
import type { LayerCodegen } from '../layers/define-layer.ts';

import { resolveModuleDir } from '../../utils/fs/index.ts';
import { isNull, isUndefined, last, relativePath } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { isOhneProject } from './is-ohne-project.ts';
import { type LayerLoadOptions, readLayerConfig } from './read-layer-config.ts';
import { parseLayerSpecifier, resolveLayerSubpath } from './resolve-layer-dir.ts';
import { type OhneLayer, resolveOhnePackages } from './resolve-ohne-layers.ts';

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

  /**
   * Files the layer generates, from its `ohne.layer.ts`, or `[]` when it ships none.
   */
  codegen: LayerCodegen[];
}

/**
 * Resolves the ordered layer stack for the app by cascading the `layers` config.
 *
 * The app's `layers` name the layers it extends; each of those names its own, and so on.
 * Only the layers reached this way are stacked - an installed layer no one lists is left out.
 * A name resolves from the layer that lists it, as Node would, so each layer gets its own install.
 * A name that layer cannot reach falls back to the app's dependency closure, `resolveOhnePackages`.
 * A name carrying a subpath (`@acme/kit/auth`) resolves through the package's `exports`.
 * The package need not be a layer itself, and the app itself counts.
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
 * // -> ['ohnejs/base', '@acme/blog', '@acme/auth', 'app']
 * ```
 */
export async function resolveLayerStack(
  from: string = process.cwd(),
  options: LayerLoadOptions = {},
): Promise<ResolvedLayer[]> {
  const packages = await resolveOhnePackages(from);
  const closure = packages.filter((pkg) => pkg.layer);
  if (closure.length === 0) return [];

  const dirByName = new Map(packages.map((pkg) => [pkg.name, pkg.dir]));
  const stack: ResolvedLayer[] = [];
  const visited = new Set<string>();

  await walk(last(closure)!);
  return stack;

  /**
   * Pushes `layer` after every layer its `layers` lists, visiting each directory once.
   */
  async function walk(layer: OhneLayer): Promise<void> {
    if (visited.has(layer.dir)) return;
    visited.add(layer.dir);

    const config = (await readLayerConfig(layer.dir, options)) ?? {
      input: {},
      defaults: {},
      strategies: {},
      codegen: [],
    };
    for (const specifier of config.input.layers ?? []) {
      const { name, subpath } = parseLayerSpecifier(specifier);
      const root = (await resolveModuleDir(name, layer.dir)) ?? dirByName.get(name);
      const dir = isUndefined(root) ? null : await resolveLayerSubpath(root, subpath);
      if (isNull(dir)) {
        throw ohneError({
          title: `Layer \`${specifier}\` cannot be used`,
          body: [
            `\`${specifier}\` is not installed, or its package does not export it as a layer.`,
            `It is listed by \`${layer.name}\`.`,
          ],
        });
      }
      if (!(await isOhneProject(dir))) {
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
