import { readdir } from 'node:fs/promises';

/**
 * Reads the names of every entry in a directory, hidden ones and symlinks included.
 *
 * Returns `null` if the directory does not exist.
 * Any other error (permissions, IO, not a directory) propagates.
 *
 * @example
 * ```ts
 * await readDir('./app')     // -> ['.env', 'ohne.config.ts', 'package.json']
 * await readDir('./missing') // -> null
 * ```
 */
export async function readDir(path: string): Promise<string[] | null> {
  try {
    return await readdir(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
