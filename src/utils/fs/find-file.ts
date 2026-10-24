import type { Stats } from 'node:fs';

import { isNull } from '../is/is-null.ts';
import { safeResolve } from '../path/safe-resolve.ts';
import { stat } from './stat.ts';

/**
 * A file `findFile` found.
 */
export interface FoundFile {
  /**
   * Absolute path to the file, under the root that holds it.
   */
  path: string;

  /**
   * The file's `Stats`, following symlinks.
   */
  stats: Stats;
}

/**
 * Finds `path` in the first of `roots` that holds it as a file.
 *
 * `path` is resolved against each root and confined to it, so `..` and absolute paths cannot escape.
 * A missing path, a directory, or a path running through a file is a miss, and the next root is tried.
 * Returns `null` when no root holds the file.
 *
 * @example
 * ```ts
 * await findFile(['./app', './base'], 'pages/home.ts')
 * // -> { path: '/project/base/pages/home.ts', stats: Stats { ... } }
 *
 * await findFile(['./app'], '../secret.ts')
 * // -> null
 * ```
 */
export async function findFile(roots: readonly string[], path: string): Promise<FoundFile | null> {
  for (const root of roots) {
    const resolved = safeResolve(root, path);
    if (isNull(resolved)) continue;
    const stats = await stat(resolved);
    if (!isNull(stats) && stats.isFile()) return { path: resolved, stats };
  }
  return null;
}
