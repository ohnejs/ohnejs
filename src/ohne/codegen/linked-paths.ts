import { realpath } from 'node:fs/promises';

import { findUp, readJSON } from '../../utils/fs/index.ts';
import { dirname, isNull, joinPath, normalizePath } from '../../utils/index.ts';

/**
 * Maps a path inside a store-installed package, like pnpm's, to the same path through `node_modules/<name>`.
 * A store path names the version, so a generated import through it breaks once the package upgrades.
 * Any other path, like a workspace package's, is returned unchanged.
 */
export async function linkedPaths(from: string): Promise<(path: string) => string> {
  const manifestPath = await findUp('package.json', from);
  if (isNull(manifestPath)) return (path) => path;
  const manifest = await readJSON<Record<string, Record<string, string> | undefined>>(manifestPath);
  const names = Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies });
  const links: [real: string, link: string][] = [];
  for (const name of names) {
    const link = joinPath(dirname(manifestPath), 'node_modules', name);
    const real = await realpath(link).then(normalizePath, () => link);
    if (real !== link && real.includes('/node_modules/')) links.push([real, link]);
  }
  return (path) => {
    for (const [real, link] of links) {
      if (path === real || path.startsWith(`${real}/`)) return link + path.slice(real.length);
    }
    return path;
  };
}
