/**
 * Ensures `path` does not start with a `/`.
 * Collapses any sequence of repeated `/` (anywhere in the string) to a single `/`.
 *
 * Operates on forward slashes only - backslashes are treated as content.
 *
 * @example
 * ```ts
 * withoutLeadingSlash('/foo')     // -> 'foo'
 * withoutLeadingSlash('foo')      // -> 'foo'
 * withoutLeadingSlash('//foo')    // -> 'foo'
 * withoutLeadingSlash('foo//bar') // -> 'foo/bar'
 * withoutLeadingSlash('/')        // -> ''
 * ```
 */
export function withoutLeadingSlash(path: string): string {
  const deduped = path.replace(/\/+/g, '/');
  return deduped.startsWith('/') ? deduped.slice(1) : deduped;
}
