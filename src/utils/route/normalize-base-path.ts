import { canonicalPath } from '../uri/canonical-path.ts';

/**
 * Normalizes a configured base path to a canonical mount prefix.
 *
 * Collapses every run of slashes to one, strips the leading and trailing slash, then re-adds one leading.
 * Escapes are canonicalized as `canonicalPath` does, so the prefix matches a canonical request path.
 * An empty path, or one that is only slashes, yields `''` - no prefix, mounted at the root.
 *
 * The result is the form `stripBasePath` expects: either `''`, or `/`-led with no trailing slash.
 *
 * @example
 * ```ts
 * normalizeBasePath('/api')       // -> '/api'
 * normalizeBasePath('api/')       // -> '/api'
 * normalizeBasePath('/api/')      // -> '/api'
 * normalizeBasePath('/api//v1')   // -> '/api/v1'
 * normalizeBasePath('/caf%c3%a9') // -> '/caf%C3%A9'
 * normalizeBasePath('')           // -> ''
 * normalizeBasePath('/')          // -> ''
 * ```
 */
export function normalizeBasePath(raw: string): string {
  const trimmed = raw.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  if (trimmed === '') return '';
  const base = '/' + trimmed;
  return canonicalPath(base) ?? base;
}
