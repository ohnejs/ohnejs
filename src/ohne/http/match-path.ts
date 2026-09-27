import {
  compileGlob,
  compileRoute,
  isNull,
  isUndefined,
  trimRoutePath,
} from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

const cache = new Map<string, (path: string) => boolean>();

/**
 * Returns the cached predicate for `pattern`: a route matcher when it holds `[`, a glob otherwise.
 */
function matcher(pattern: string): (path: string) => boolean {
  let compiled = cache.get(pattern);
  if (isUndefined(compiled)) {
    if (pattern.includes('[')) {
      const route = compileRoute(pattern);
      compiled = (path) => !isNull(route(path));
    } else {
      const glob = compileGlob(pattern);
      compiled = (path) => glob(path) || glob(trimRoutePath(path));
    }
    cache.set(pattern, compiled);
  }
  return compiled;
}

/**
 * Tests a path against one or more patterns, reusing a process-wide compiled-matcher cache.
 * Returns `true` when `path` matches any candidate.
 *
 * A pattern is a route pattern when it contains a `[param]`, matched like a route (`/authors/[id]`).
 * Otherwise it is a glob with the same syntax as `disable.routes`: `*` per segment, `**` across segments.
 * A glob also tests the path as a route matches it, with one trailing `/` dropped.
 *
 * Use this when you have a path in hand; `matchPath` is the shorthand for the current request.
 *
 * @example
 * ```ts
 * matchesPath('/admin/users', '/admin/**')        // -> true
 * matchesPath('/admin/users', '/admin/[section]') // -> true
 * matchesPath('/admin/users', '/public/**')       // -> false
 * ```
 */
export function matchesPath(path: string, ...patterns: string[]): boolean {
  return patterns.some((pattern) => matcher(pattern)(path));
}

/**
 * Tests the current request's path against one or more patterns.
 * Shorthand for `matchesPath(useEvent().url.pathname, ...patterns)`, sharing its matcher cache.
 * Valid only within a request.
 * The request path is canonical, its unreserved escapes decoded.
 *
 * Pair it with a middleware to scope global middleware to part of the app.
 *
 * @example
 * ```ts
 * // inside a middleware, for GET /admin/users
 * matchPath('/admin/**')          // -> true
 * matchPath('/admin/[section]')   // -> true
 * matchPath('/public/**')         // -> false
 * matchPath('/public/*', '/a/**') // -> false
 * ```
 */
export function matchPath(...patterns: string[]): boolean {
  return matchesPath(useEvent().url.pathname, ...patterns);
}
