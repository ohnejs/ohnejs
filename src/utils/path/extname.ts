/**
 * Returns the extension of the last segment of `path`, including the leading dot.
 * Empty string if the segment has no extension, ends with a slash, or is a dotfile.
 *
 * For segments with multiple dots, only the last extension is returned (e.g. `'archive.tar.gz'` -> `'.gz'`).
 * A dotfile (`'.hidden'`) has no extension.
 * Backslashes are treated as separators.
 *
 * @example
 * ```ts
 * extname('foo.txt')             // -> '.txt'
 * extname('/a/b/foo.txt')        // -> '.txt'
 * extname('archive.tar.gz')      // -> '.gz'
 * extname('.hidden')             // -> ''
 * extname('foo')                 // -> ''
 * extname('foo.')                // -> '.'
 * ```
 */
export function extname(path: string): string {
  if (path.length === 0) return '';
  const slashed = path.replaceAll('\\', '/');
  const lastSlash = slashed.lastIndexOf('/');
  const lastDot = slashed.lastIndexOf('.');
  if (lastDot === -1 || lastDot < lastSlash) return '';
  if (lastDot === lastSlash + 1) return '';
  return slashed.slice(lastDot);
}
