import { childPath } from '../path/child-path.ts';
import { readDir } from './read-dir.ts';
import { removeDir } from './remove-dir.ts';

/**
 * Removes everything inside the directory at `path`, keeping the directory itself.
 *
 * Silent if nothing exists there.
 *
 * @example
 * ```ts
 * await emptyDir('./build')
 * ```
 */
export async function emptyDir(path: string): Promise<void> {
  const names = (await readDir(path)) ?? [];
  await Promise.all(names.map((name) => removeDir(childPath(path, name))));
}
