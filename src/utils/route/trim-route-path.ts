/**
 * Drops one trailing `/` from a request path, as a route matcher does before it matches.
 * The root path `/` stays as it is.
 *
 * @example
 * ```ts
 * trimRoutePath('/admin/users/') // -> '/admin/users'
 * trimRoutePath('/admin//')      // -> '/admin/'
 * trimRoutePath('/admin')        // -> '/admin'
 * trimRoutePath('/')             // -> '/'
 * ```
 */
export function trimRoutePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
