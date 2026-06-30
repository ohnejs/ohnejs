import type { Stats } from 'node:fs';

import { stat as fsStat } from 'node:fs/promises';

/**
 * Reads a path's `Stats`, following symlinks.
 *
 * Returns `null` if the path does not exist.
 * Any other error (permissions, IO) propagates.
 *
 * @example
 * ```ts
 * (await stat('./.env'))?.size // -> byte size, or undefined when missing
 * await stat('./missing')      // -> null
 * ```
 */
export async function stat(path: string): Promise<Stats | null> {
  try {
    return await fsStat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
