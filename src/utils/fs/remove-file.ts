import { unlink } from 'node:fs/promises';

/**
 * Removes the file at `path`.
 *
 * Silent if the file does not exist (already gone is success).
 * Throws on permission errors or if the path is a directory.
 *
 * @example
 * ```ts
 * await removeFile('./cache.json')
 * ```
 */
export async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}
