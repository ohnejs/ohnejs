import { pathRoot } from './path-root.ts';

/**
 * Returns the last segment of `path`.
 * Syntactic: looks at the literal segments, does not resolve `.` or `..`.
 * Trailing slashes are ignored.
 * Backslashes are treated as separators.
 *
 * If `ext` is given and the segment ends with it (and is not exactly equal to it), it is stripped.
 *
 * @example
 * ```ts
 * basename('/foo/bar.txt')               // -> 'bar.txt'
 * basename('/foo/bar.txt', '.txt')       // -> 'bar'
 * basename('/foo/bar/')                  // -> 'bar'
 * basename('C:/foo')                     // -> 'foo'
 * basename('.hidden', '.hidden')         // -> '.hidden'
 * basename('/')                          // -> ''
 * ```
 */
export function basename(path: string, ext?: string): string {
  if (path.length === 0) return '';
  const slashed = path.replaceAll('\\', '/');
  const rootLen = pathRoot(slashed).length;

  let end = slashed.length;
  while (end > rootLen && slashed.charCodeAt(end - 1) === 47) end--;

  if (end <= rootLen) return '';

  const lastSlash = slashed.lastIndexOf('/', end - 1);
  const start = lastSlash >= rootLen ? lastSlash + 1 : rootLen;
  const base = slashed.slice(start, end);

  if (ext && ext.length < base.length && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}
