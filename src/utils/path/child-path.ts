/**
 * Appends `name` to the directory `dir` verbatim, for a name read from disk.
 * A `\` or `..` in `name` stays part of the name, as both are legal in a POSIX file name.
 * `joinPath` would read them as path syntax and point somewhere else.
 *
 * @example
 * ```ts
 * childPath('/app', 'x\\y.ts') // -> '/app/x\\y.ts'
 * childPath('/app', 'd\\..')   // -> '/app/d\\..'
 * childPath('/', 'etc')        // -> '/etc'
 * ```
 */
export function childPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}
