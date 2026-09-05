import { rm } from 'node:fs/promises';

/**
 * Removes the file or directory at `path`, a directory along with its entire contents.
 *
 * Silent if nothing exists there.
 * Throws on permission errors.
 *
 * @example
 * ```ts
 * await removeDir('./build')
 * ```
 */
export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
