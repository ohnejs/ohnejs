import { rm } from 'node:fs/promises';

/**
 * Removes the directory at `path` along with its entire contents.
 *
 * Silent if the directory does not exist.
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
