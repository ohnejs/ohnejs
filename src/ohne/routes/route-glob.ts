import { compileGlob, type HTTPMethod, isNull } from '../../utils/index.ts';

const METHOD_PREFIX_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (.+)$/i;

/**
 * Compiles route globs, as `disable.routes` takes them, into one test that holds when any glob matches.
 * A glob with no method prefix matches a route's pattern regardless of method.
 * A glob with a `METHOD ` prefix, in any case, matches only a route bound to that method.
 * `*` matches within one segment, `**` across segments, and a `[param]` matches only itself.
 *
 * @example
 * ```ts
 * const matches = routeGlobMatcher(['/internal/**', 'DELETE /collections/[collection]/**'])
 *
 * matches('GET', '/internal/stats')                     // -> true
 * matches('DELETE', '/collections/[collection]/[uuid]') // -> true
 * matches('PATCH', '/collections/[collection]/[uuid]')  // -> false
 * ```
 */
export function routeGlobMatcher(
  globs: readonly string[],
): (method: HTTPMethod | null, pattern: string) => boolean {
  const matchers = globs.map((glob) => {
    const prefixed = glob.match(METHOD_PREFIX_RE);
    if (isNull(prefixed)) {
      const match = compileGlob(glob);
      return (_: HTTPMethod | null, pattern: string) => match(pattern);
    }
    const method = prefixed[1].toUpperCase() as HTTPMethod;
    const match = compileGlob(prefixed[2]);
    return (other: HTTPMethod | null, pattern: string) => other === method && match(pattern);
  });

  return (method, pattern) => matchers.some((match) => match(method, pattern));
}
