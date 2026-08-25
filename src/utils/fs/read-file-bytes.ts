import { readFile as fsReadFile } from 'node:fs/promises';

/**
 * Reads a file's raw bytes.
 *
 * Returns `null` if the file does not exist.
 * Any other error (permissions, IO) propagates.
 *
 * @example
 * ```ts
 * await readFileBytes('./logo.png') // -> Uint8Array contents
 * await readFileBytes('./missing')  // -> null
 * ```
 */
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
  try {
    return await fsReadFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
