/**
 * Normalizes a configured base path to a canonical mount prefix.
 *
 * Collapses every run of slashes to one, strips the leading and trailing slash, then re-adds one leading.
 * An empty path, or one that is only slashes, yields `''` - no prefix, mounted at the root.
 *
 * The result is the form `stripBasePath` expects: either `''`, or `/`-led with no trailing slash.
 *
 * @example
 * ```ts
 * normalizeBasePath('/api')     // -> '/api'
 * normalizeBasePath('api/')     // -> '/api'
 * normalizeBasePath('/api/')    // -> '/api'
 * normalizeBasePath('/api//v1') // -> '/api/v1'
 * normalizeBasePath('')         // -> ''
 * normalizeBasePath('/')        // -> ''
 * ```
 */
export function normalizeBasePath(raw: string): string {
  const trimmed = raw.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  return trimmed === '' ? '' : '/' + trimmed;
}
