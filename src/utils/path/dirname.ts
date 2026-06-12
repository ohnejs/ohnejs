import { pathRoot } from './path-root.ts';

/**
 * Returns the directory portion of `path`.
 * Syntactic: looks at the literal segments, does not resolve `.` or `..`.
 * Trailing slashes are ignored.
 * Backslashes are treated as separators.
 *
 * If the path has no parent (it is the root or has no separators), the root or `'.'` is returned.
 *
 * @example
 * ```ts
 * dirname('/foo/bar/baz')        // -> '/foo/bar'
 * dirname('/foo')                // -> '/'
 * dirname('foo/bar')             // -> 'foo'
 * dirname('foo')                 // -> '.'
 * dirname('C:/foo/bar')          // -> 'C:/foo'
 * dirname('C:/foo')              // -> 'C:/'
 * dirname('//srv/sh/foo')        // -> '//srv/sh'
 * dirname('')                    // -> '.'
 * ```
 */
export function dirname(path: string): string {
  if (path.length === 0) return '.';
  const slashed = path.replaceAll('\\', '/');
  const root = pathRoot(slashed);
  const rootLen = root.length;

  let end = slashed.length;
  while (end > rootLen && slashed.charCodeAt(end - 1) === 47) end--;

  if (end <= rootLen) return rootLen > 0 ? root : '.';

  const lastSlash = slashed.lastIndexOf('/', end - 1);
  if (lastSlash < rootLen) return rootLen > 0 ? root : '.';
  return slashed.slice(0, lastSlash);
}
