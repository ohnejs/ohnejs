import { readdir } from 'node:fs/promises';

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
  const names = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  // A raw join: `joinPath` would read a `\` in a POSIX name as a separator and fold `..` lexically.
  await Promise.all(names.map((name) => removeDir(`${path}/${name}`)));
}
