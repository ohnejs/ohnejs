import { dirname } from '../path/dirname.ts';
import { joinPath } from '../path/join-path.ts';
import { resolvePath } from '../path/resolve-path.ts';
import { exists } from './exists.ts';

/**
 * Searches for an entry named `name`, starting at `from` and walking up to the filesystem root.
 * `from` defaults to `process.cwd()` and is resolved against it when relative.
 *
 * Returns the absolute, normalized path to the first match, or `null` if none is found.
 *
 * @example
 * ```ts
 * await findUp('package.json')            // -> '/srv/app/package.json' | null
 * await findUp('.git', '/srv/app/src/ui') // -> '/srv/app/.git'         | null
 * ```
 */
export async function findUp(name: string, from: string = process.cwd()): Promise<string | null> {
  let dir = resolvePath(from);
  while (true) {
    const candidate = joinPath(dir, name);
    if (await exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
