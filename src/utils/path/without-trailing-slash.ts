/**
 * Ensures `path` does not end with a `/`.
 * Collapses any sequence of repeated `/` (anywhere in the string) to a single `/`.
 *
 * Operates on forward slashes only - backslashes are treated as content.
 *
 * @example
 * ```ts
 * withoutTrailingSlash('foo/')         // -> 'foo'
 * withoutTrailingSlash('foo')          // -> 'foo'
 * withoutTrailingSlash('foo//')        // -> 'foo'
 * withoutTrailingSlash('foo//bar')     // -> 'foo/bar'
 * withoutTrailingSlash('/')            // -> ''
 * ```
 */
export function withoutTrailingSlash(path: string): string {
  const deduped = path.replace(/\/+/g, '/');
  return deduped.endsWith('/') ? deduped.slice(0, -1) : deduped;
}
