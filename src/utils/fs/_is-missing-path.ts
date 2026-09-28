const MISSING = new Set(['ENOENT', 'ENOTDIR', 'ENAMETOOLONG']);

/**
 * Whether a filesystem error means the path names nothing.
 * That covers a missing entry, a path that runs through a file, and a name too long to exist.
 *
 * @example
 * ```ts
 * isMissingPath({ code: 'ENOTDIR' }) // -> true
 * isMissingPath({ code: 'EACCES' })  // -> false
 * ```
 */
export function isMissingPath(error: unknown): boolean {
  return MISSING.has((error as NodeJS.ErrnoException).code ?? '');
}
