/**
 * Checks whether `path` is absolute.
 * Absolute roots are POSIX (`/`), Windows drive (`C:/` or `C:\`), and UNC (`//srv/...` or `\\srv\...`).
 *
 * A bare drive prefix (`C:foo`) is drive-relative, not absolute.
 *
 * @example
 * ```ts
 * isAbsolutePath('/foo')         // -> true
 * isAbsolutePath('C:/foo')       // -> true
 * isAbsolutePath('C:\\foo')      // -> true
 * isAbsolutePath('\\\\srv\\sh')  // -> true
 * isAbsolutePath('//srv/sh')     // -> true
 *
 * isAbsolutePath('foo/bar')      // -> false
 * isAbsolutePath('C:foo')        // -> false
 * isAbsolutePath('')             // -> false
 * ```
 */
export function isAbsolutePath(path: string): boolean {
  if (path.length === 0) return false;
  const first = path.charCodeAt(0);
  if (first === 47 || first === 92) return true; // '/' or '\\'
  if (path.length >= 3) {
    const second = path.charCodeAt(1);
    const third = path.charCodeAt(2);
    const isLetter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
    if (isLetter && second === 58 && (third === 47 || third === 92)) return true;
  }
  return false;
}
