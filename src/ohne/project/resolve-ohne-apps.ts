import { realpath } from 'node:fs/promises';

import { findUp, readJSON, resolveModuleDir } from '../../utils/fs/index.ts';
import { dirname, isNull, joinPath, normalizePath } from '../../utils/index.ts';
import { isOhneProject } from './is-ohne-project.ts';

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Resolves the dependency closure of the current ohne app.
 * Returns the names of every ohne project within it, sorted, and never the app itself.
 *
 * The app is located by walking up from `from` (default `process.cwd()`) to the nearest `package.json`.
 * In a monorepo this is the package you are in, not the workspace root.
 *
 * Its full dependency set is walked.
 * That covers `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
 * Transitive packages contribute only their non-dev dependencies.
 * A dependency's dev dependencies are not installed for you.
 *
 * Each package is resolved through Node's `node_modules` lookup and keyed by its real path.
 * Repeated paths from pnpm symlinks or shared versions are visited only once.
 *
 * Returns `[]` when no `package.json` is found.
 *
 * @example
 * ```ts
 * await resolveOhneApps()           // -> ['@acme/auth', '@acme/ui']
 * await resolveOhneApps('/srv/lib') // -> []
 * ```
 */
export async function resolveOhneApps(from: string = process.cwd()): Promise<string[]> {
  const manifestPath = await findUp('package.json', from);
  if (isNull(manifestPath)) return [];

  const rootManifest = await readJSON<Manifest>(manifestPath);
  if (isNull(rootManifest)) return [];

  const rootDir = dirname(manifestPath);
  const apps = new Set<string>();
  const visited = new Set<string>();
  visited.add(normalizePath(await realpath(rootDir)));

  await walk(rootDir, depNames(rootManifest, true));
  return [...apps].sort();

  async function walk(base: string, names: string[]): Promise<void> {
    for (const name of names) {
      const dir = await resolveModuleDir(name, base);
      if (isNull(dir) || visited.has(dir)) continue;
      visited.add(dir);

      const manifest = await readJSON<Manifest>(joinPath(dir, 'package.json'));
      if (isNull(manifest)) continue;

      if (await isOhneProject(dir)) apps.add(manifest.name ?? name);
      await walk(dir, depNames(manifest, false));
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
