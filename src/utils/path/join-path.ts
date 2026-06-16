import { normalizePath } from './normalize-path.ts';

/**
 * Joins path segments with `/` and normalizes the result.
 * Empty segments are skipped.
 * With no arguments (or only empty arguments) the result is `'.'`.
 *
 * Joining never restarts at an absolute segment: a leading `/` on a later segment is treated as a separator.
 * Use the segment directly if you want absolute semantics.
 *
 * @example
 * ```ts
 * joinPath('foo', 'bar', 'baz')     // -> 'foo/bar/baz'
 * joinPath('/foo/', '/bar/', 'baz') // -> '/foo/bar/baz'
 * joinPath('foo', '..', 'bar')      // -> 'bar'
 * joinPath('C:\\foo', 'bar')        // -> 'C:/foo/bar'
 * joinPath()                        // -> '.'
 * ```
 */
export function joinPath(...segments: string[]): string {
  const filtered = segments.filter((segment) => segment.length > 0);
  if (filtered.length === 0) return '.';
  return normalizePath(filtered.join('/'));
}
