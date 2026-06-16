/**
 * Ensures `path` ends with exactly one `/`.
 * Collapses any sequence of repeated `/` (anywhere in the string) to a single `/`.
 *
 * Operates on forward slashes only - backslashes are treated as content.
 *
 * @example
 * ```ts
 * withTrailingSlash('foo')      // -> 'foo/'
 * withTrailingSlash('foo/')     // -> 'foo/'
 * withTrailingSlash('foo//')    // -> 'foo/'
 * withTrailingSlash('foo//bar') // -> 'foo/bar/'
 * withTrailingSlash('')         // -> '/'
 * ```
 */
export function withTrailingSlash(path: string): string {
  const deduped = path.replace(/\/+/g, '/');
  return deduped.endsWith('/') ? deduped : `${deduped}/`;
}
