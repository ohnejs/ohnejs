import { realpath } from 'node:fs/promises';

import { findUp, readJSON, resolveModuleDir } from '../../utils/fs/index.ts';
import { basename, dirname, isNull, joinPath, normalizePath } from '../../utils/index.ts';
import { isOhneProject } from './is-ohne-project.ts';

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * A single ohne layer: a project that contributes to the current app.
 */
export interface OhneLayer {
  /**
   * Package name of the layer, or its full specifier (`@acme/kit/auth`) for a subpath layer.
   * The app falls back to its directory name when its manifest has none.
   */
  name: string;

  /**
   * Absolute directory of the layer's package root.
   */
  dir: string;
}

/**
 * A package in the app's dependency closure, whether or not its root is a layer.
 */
export interface OhnePackage extends OhneLayer {
  /**
   * Whether the package root holds an `ohne.config.ts`, making the package itself a layer.
   * The app is always one, so its own content is never skipped.
   */
  layer: boolean;
}

/**
 * Resolves every package in the current app's dependency closure, in registration order.
 *
 * The closure runs furthest-first: a package is positioned before the packages that depend on it.
 * The app itself comes last.
 * Non-ohne packages are kept, since one may export layers as subpaths without being a layer itself.
 * `resolveOhneLayers` is this list reduced to the layers.
 * The root's dev dependencies count; a transitive package's do not.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveOhnePackages()
 * // -> [
 * //      { name: 'ohnejs', dir: '...', layer: true },
 * //      { name: '@acme/kit', dir: '...', layer: false },
 * //      { name: 'app', dir: '...', layer: true },
 * //    ]
 * ```
 */
export async function resolveOhnePackages(from: string = process.cwd()): Promise<OhnePackage[]> {
  const manifestPath = await findUp('package.json', from);
  if (isNull(manifestPath)) return [];

  const rootManifest = (await readJSON<Manifest>(manifestPath)) ?? {};
  const appDir = dirname(manifestPath);
  const packages: OhnePackage[] = [];
  const visited = new Set<string>();
  visited.add(normalizePath(await realpath(appDir)));

  await walk(appDir, depNames(rootManifest, true));
  packages.push({ name: rootManifest.name ?? basename(appDir), dir: appDir, layer: true });
  return packages;

  /**
   * Pushes each resolvable package in `names` after its own dependencies, visiting each directory once.
   */
  async function walk(base: string, names: string[]): Promise<void> {
    for (const name of names) {
      const dir = await resolveModuleDir(name, base);
      if (isNull(dir) || visited.has(dir)) continue;
      visited.add(dir);

      const manifest = await readJSON<Manifest>(joinPath(dir, 'package.json'));
      if (isNull(manifest)) continue;

      await walk(dir, depNames(manifest, false));
      packages.push({ name: manifest.name ?? name, dir, layer: await isOhneProject(dir) });
    }
  }
}

/**
 * Resolves every ohne layer in the current app's dependency closure, whether or not `Config.layers` lists it.
 * The stack ohne merges comes from `resolveLayerStack`, which keeps only the layers `Config.layers` reaches.
 *
 * The list runs furthest-first: a layer is positioned before the layers that depend on it.
 * The app itself comes last.
 *
 * The graph is walked depth-first in post-order, so a dependency is emitted before its dependent.
 * Unrelated sibling layers keep the order they are declared in.
 * Only ohne projects become layers.
 * Non-ohne packages are still traversed to reach the ohne layers behind them.
 * The root's dev dependencies count; a transitive layer's do not.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveOhneLayers()
 * // -> [
 * //      { name: 'ohnejs', dir: '...' },
 * //      { name: '@acme/base', dir: '...' },
 * //      { name: '@acme/auth', dir: '...' },
 * //      { name: 'app', dir: '...' },
 * //    ]
 * ```
 */
export async function resolveOhneLayers(from: string = process.cwd()): Promise<OhneLayer[]> {
  const packages = await resolveOhnePackages(from);
  return packages.filter((pkg) => pkg.layer).map(({ name, dir }) => ({ name, dir }));
}

/**
 * The dependency names a manifest declares, dev dependencies included only when asked.
 */
function depNames(manifest: Manifest, includeDev: boolean): string[] {
  const groups = [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
    includeDev ? manifest.devDependencies : undefined,
  ];
  return groups.flatMap((group) => (group ? Object.keys(group) : []));
}
