import { isPathInside } from './is-path-inside.ts';
import { resolvePath } from './resolve-path.ts';

/**
 * Resolves an untrusted `path` against `base`, refusing anything that escapes `base`.
 *
 * Returns the normalized absolute path when it stays inside `base`.
 * Returns `null` when the path would break out via `..` segments or an absolute path.
 * Use it before mapping a request param onto the filesystem.
 * `base` itself (an empty or `.` path) resolves to `base` and is allowed.
 *
 * The check is lexical: it normalizes and checks containment, it does not touch the disk or follow symlinks.
 *
 * @example
 * ```ts
 * safeResolve('/srv/files', 'a/b.txt')     // -> '/srv/files/a/b.txt'
 * safeResolve('/srv/files', '')            // -> '/srv/files'
 * safeResolve('/srv/files', '../etc')      // -> null
 * safeResolve('/srv/files', '/etc/passwd') // -> null
 * ```
 */
export function safeResolve(base: string, path: string): string | null {
  const root = resolvePath(base);
  const resolved = resolvePath(path, root);
  return isPathInside(resolved, root) ? resolved : null;
}
