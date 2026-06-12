/**
 * Ensures `path` starts with exactly one `/`.
 * Collapses any sequence of repeated `/` (anywhere in the string) to a single `/`.
 *
 * Operates on forward slashes only - backslashes are treated as content.
 *
 * @example
 * ```ts
 * withLeadingSlash('foo')          // -> '/foo'
 * withLeadingSlash('/foo')         // -> '/foo'
 * withLeadingSlash('//foo')        // -> '/foo'
 * withLeadingSlash('foo//bar')     // -> '/foo/bar'
 * withLeadingSlash('')             // -> '/'
 * ```
 */
export function withLeadingSlash(path: string): string {
  const deduped = path.replace(/\/+/g, '/');
  return deduped.startsWith('/') ? deduped : `/${deduped}`;
}
