/**
 * Strips a normalized base path off a URL pathname at a segment boundary.
 *
 * Pass a `basePath` already canonicalized by `normalizeBasePath` (either `''`, or `/`-led).
 * An empty base returns the pathname unchanged: nothing is mounted, so nothing is stripped.
 * Otherwise the pathname must sit under the base - equal to it, or continuing past a `/`.
 * The base is removed and the remainder returned, always `/`-led, so the mount root maps to `'/'`.
 * A pathname outside the mount returns `null`, so the caller can answer `404`.
 *
 * Matching is by whole segment, so `/apiece` is not under `/api`.
 *
 * @example
 * ```ts
 * stripBasePath('/api/users', '/api') // -> '/users'
 * stripBasePath('/api', '/api')       // -> '/'
 * stripBasePath('/api/', '/api')      // -> '/'
 * stripBasePath('/users', '')         // -> '/users'
 * stripBasePath('/users', '/api')     // -> null
 * stripBasePath('/apiece', '/api')    // -> null
 * ```
 */
export function stripBasePath(pathname: string, basePath: string): string | null {
  if (basePath === '') return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(basePath + '/')) return pathname.slice(basePath.length);
  return null;
}
