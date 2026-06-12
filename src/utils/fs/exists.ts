import { access } from 'node:fs/promises';

/**
 * Reports whether a path exists.
 *
 * Returns `false` only when the path is genuinely absent.
 * Permission errors (`EACCES`, `EPERM`) propagate.
 * "Cannot access" is not the same as "does not exist".
 *
 * @example
 * ```ts
 * await exists('./.env')    // -> true | false
 * ```
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
