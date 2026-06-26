import { isAbsolutePath } from './is-absolute-path.ts';
import { relativePath } from './relative-path.ts';

/**
 * Checks whether `path` is `dir` itself or nested anywhere beneath it.
 * Both inputs are normalized first; the check is lexical, never touching the disk.
 *
 * Returns `false` when the two sit on different absolute roots (different drive letters or UNC shares).
 *
 * @example
 * ```ts
 * isPathInside('/a/b/c.ts', '/a/b')   // -> true
 * isPathInside('/a/b/..x.ts', '/a/b') // -> true
 * isPathInside('/a/b', '/a/b')        // -> true
 * isPathInside('/a/c.ts', '/a/b')     // -> false
 * isPathInside('/a', '/a/b')          // -> false
 * isPathInside('D:/x/y', 'C:/x')      // -> false
 * ```
 */
export function isPathInside(path: string, dir: string): boolean {
  const rel = relativePath(dir, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolutePath(rel));
}
