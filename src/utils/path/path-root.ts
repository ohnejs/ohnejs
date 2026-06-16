/**
 * Returns the root prefix of a path, with `\` converted to `/`.
 * Empty string if the path is relative.
 *
 * Root forms:
 * - POSIX absolute: `'/'`
 * - Windows drive absolute (`C:/...`, `C:\...`): `'C:/'`
 * - Windows drive relative (`C:foo`): `'C:'`
 * - UNC (`//server/share/...`, `\\server\share\...`): `'//server/share'`
 *
 * @example
 * ```ts
 * pathRoot('/foo/bar')         // -> '/'
 * pathRoot('C:/foo')           // -> 'C:/'
 * pathRoot('C:foo')            // -> 'C:'
 * pathRoot('\\\\srv\\sh\\foo') // -> '//srv/sh'
 * pathRoot('foo/bar')          // -> ''
 * ```
 */
export function pathRoot(path: string): string {
  if (path.length === 0) return '';
  const slashed = path.replaceAll('\\', '/');
  const unc = slashed.match(/^\/\/[^/]+\/[^/]+/);
  if (unc) return unc[0];
  const driveAbs = slashed.match(/^[a-zA-Z]:\//);
  if (driveAbs) return driveAbs[0];
  const driveRel = slashed.match(/^[a-zA-Z]:/);
  if (driveRel) return driveRel[0];
  if (slashed.startsWith('/')) return '/';
  return '';
}
