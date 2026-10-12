import { realpath } from 'node:fs/promises';

import { basename } from '../path/basename.ts';
import { dirname } from '../path/dirname.ts';
import { joinPath } from '../path/join-path.ts';
import { normalizePath } from '../path/normalize-path.ts';
import { resolvePath } from '../path/resolve-path.ts';
import { exists } from './exists.ts';
import { findUp } from './find-up.ts';
import { readJSON } from './read-json.ts';

/**
 * Resolves the installed directory of the package `name`, as seen from `from`.
 *
 * Mirrors Node's `node_modules` lookup.
 * Like Node, it first tries a self-reference.
 * The package around `from` resolves to itself when it is `name` and has `exports`, as `from` reaches it.
 * Otherwise it probes `<dir>/node_modules/<name>` at `from`, then walks up, skipping `node_modules` segments.
 * This finds hoisted and workspace-level installs, not just a sibling `node_modules`.
 * A `node_modules` match is passed through `realpath`, so pnpm symlinks collapse to the real store location.
 *
 * Returns the absolute, normalized package directory, or `null` if the package is not installed.
 *
 * @example
 * ```ts
 * await resolveModuleDir('typescript', '/srv/app')
 * // -> '/srv/app/node_modules/typescript' | null
 *
 * await resolveModuleDir('@scope/pkg', '/srv/app/src')
 * // -> '/srv/.pnpm/@scope/pkg/...' | null
 * ```
 */
export async function resolveModuleDir(name: string, from: string): Promise<string | null> {
  const scope = await findUp('package.json', from);
  if (scope) {
    const manifest = await readJSON<{ name?: string; exports?: unknown }>(scope);
    if (manifest?.name === name && manifest.exports !== undefined)
      return normalizePath(dirname(scope));
  }

  let dir = resolvePath(from);
  while (true) {
    if (basename(dir) !== 'node_modules') {
      const candidate = joinPath(dir, 'node_modules', name);
      if (await exists(joinPath(candidate, 'package.json'))) {
        return normalizePath(await realpath(candidate));
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
