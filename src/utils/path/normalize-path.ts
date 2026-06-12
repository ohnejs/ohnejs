import { isUndefined } from '../is/is-undefined.ts';

/**
 * Normalizes a path string.
 * Converts `\` to `/`, collapses repeated `/`, and resolves `.` and `..`.
 * Strips trailing `/` except at the root.
 *
 * Handles Windows roots: drive letters (`C:/`, `C:`) and UNC shares (`//server/share`).
 * Drive-letter case is preserved.
 *
 * An empty input becomes `'.'`.
 * A purely relative path that resolves to nothing also becomes `'.'`.
 * `..` segments that would escape an absolute root are dropped; in a relative path they are kept.
 *
 * @example
 * ```ts
 * normalizePath('foo//bar/./baz')          // -> 'foo/bar/baz'
 * normalizePath('foo/bar/../baz')          // -> 'foo/baz'
 * normalizePath('/foo/../..')              // -> '/'
 * normalizePath('foo/../..')               // -> '..'
 * normalizePath('C:\\foo\\..\\bar')        // -> 'C:/bar'
 * normalizePath('//server/share/a/../b')   // -> '//server/share/b'
 * normalizePath('')                        // -> '.'
 * ```
 */
export function normalizePath(path: string): string {
  if (path.length === 0) return '.';

  const slashed = path.replaceAll('\\', '/');

  let prefix = '';
  let absolute = false;
  let body = slashed;

  const uncMatch = body.match(/^\/\/([^/]+)\/([^/]+)/);
  if (uncMatch) {
    prefix = uncMatch[0];
    body = body.slice(prefix.length);
    absolute = true;
  } else {
    const driveMatch = body.match(/^([a-zA-Z]:)/);
    if (driveMatch) {
      prefix = driveMatch[0];
      body = body.slice(2);
    }
    if (body.startsWith('/')) absolute = true;
  }

  const resolved: string[] = [];
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const top = resolved[resolved.length - 1];
      if (!isUndefined(top) && top !== '..') {
        resolved.pop();
      } else if (!absolute) {
        resolved.push('..');
      }
      continue;
    }
    resolved.push(segment);
  }

  const joined = resolved.join('/');

  if (uncMatch) return joined ? `${prefix}/${joined}` : prefix;
  if (prefix) return `${prefix}${absolute ? '/' : ''}${joined}`;
  if (absolute) return `/${joined}`;
  return joined || '.';
}
