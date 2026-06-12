import { last } from '../array/last.ts';
import { extname } from './extname.ts';
import { normalizePath } from './normalize-path.ts';

const HAS_ALNUM = /[A-Za-z0-9]/;

/**
 * Splits a relative path into the segments used to derive a name from it.
 * Normalizes slashes and `.`/`..`.
 * Strips the extension on the last segment.
 * Collapses a trailing `index` segment into its parent.
 * Drops segments with no ASCII alphanumeric characters.
 *
 * Foundation for `pathToPascalName`, `pathToCamelName`, and `pathToKebabName`.
 *
 * @example
 * ```ts
 * pathNameSegments('foo/bar-baz.ts')   // -> ['foo', 'bar-baz']
 * pathNameSegments('foo/index.ts')     // -> ['foo']
 * pathNameSegments('./foo/bar.ts')     // -> ['foo', 'bar']
 * pathNameSegments('src\\foo\\bar.ts') // -> ['src', 'foo', 'bar']
 * pathNameSegments('index.ts')         // -> []
 * pathNameSegments('')                 // -> []
 * ```
 */
export function pathNameSegments(relativePath: string): string[] {
  const normalized = normalizePath(relativePath);
  if (normalized === '.') return [];
  const ext = extname(normalized);
  const stripped = ext ? normalized.slice(0, -ext.length) : normalized;
  const segments = stripped.split('/').filter((s) => HAS_ALNUM.test(s));
  if (segments.length === 0) return [];
  if (last(segments) === 'index') segments.pop();
  return segments;
}
