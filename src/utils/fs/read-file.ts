import { readFile as fsReadFile } from 'node:fs/promises';

/**
 * Reads a UTF-8 text file.
 *
 * Returns `null` if the file does not exist.
 * Any other error (permissions, IO) propagates.
 *
 * @example
 * ```ts
 * await readFile('./.env')    // -> string contents
 * await readFile('./missing') // -> null
 * ```
 */
export async function readFile(path: string): Promise<string | null> {
  try {
    return await fsReadFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
