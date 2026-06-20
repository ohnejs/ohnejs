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
   * Package name of the layer.
   * Falls back to the directory name when the manifest has none.
   */
  name: string;

  /**
   * Absolute directory of the layer's package root.
   */
  dir: string;
}

/**
 * Resolves the ordered layer stack for the current ohne app.
 *
 * The stack runs furthest-first: a layer is positioned before the layers that depend on it.
 * The app itself comes last.
 * That order is the merge order everywhere in ohne: later overrides earlier.
 * So a layer overrides every layer it pulls in, and the app overrides them all.
 *
 * The graph is walked depth-first in post-order, so a dependency is emitted before its dependent.
 * Unrelated sibling layers keep the order they are declared in, with the later one winning.
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
 * //      { name: 'ohne', dir: '...' },
 * //      { name: '@acme/base', dir: '...' },
 * //      { name: '@acme/auth', dir: '...' },
 * //      { name: 'app', dir: '...' },
 * //    ]
 * ```
 */
export async function resolveOhneLayers(from: string = process.cwd()): Promise<OhneLayer[]> {
  const manifestPath = await findUp('package.json', from);
  if (isNull(manifestPath)) return [];

  const rootManifest = (await readJSON<Manifest>(manifestPath)) ?? {};
  const appDir = dirname(manifestPath);
  const layers: OhneLayer[] = [];
  const visited = new Set<string>();
  visited.add(normalizePath(await realpath(appDir)));

  await walk(appDir, depNames(rootManifest, true));
  layers.push({ name: rootManifest.name ?? basename(appDir), dir: appDir });
  return layers;

  async function walk(base: string, names: string[]): Promise<void> {
    for (const name of names) {
      const dir = await resolveModuleDir(name, base);
      if (isNull(dir) || visited.has(dir)) continue;
      visited.add(dir);

      const manifest = await readJSON<Manifest>(joinPath(dir, 'package.json'));
      if (isNull(manifest)) continue;

      await walk(dir, depNames(manifest, false));
      if (await isOhneProject(dir)) layers.push({ name: manifest.name ?? name, dir });
    }
  }
}

function depNames(manifest: Manifest, includeDev: boolean): string[] {
  const groups = [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
    includeDev ? manifest.devDependencies : undefined,
  ];
  return groups.flatMap((group) => (group ? Object.keys(group) : []));
}
