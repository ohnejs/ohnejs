import { access } from 'node:fs/promises';

import { isMissingPath } from './_is-missing-path.ts';

/**
 * Reports whether a path exists.
 *
 * Returns `false` only when the path is genuinely absent.
 * Permission errors (`EACCES`, `EPERM`) propagate.
 *
 * @example
 * ```ts
 * await exists('./.env') // -> true | false
 * ```
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if (isMissingPath(err)) return false;
    throw err;
  }
}
