import type { HTTPMethod, RouteMatcher, RouteParams } from '../../utils/index.ts';
import type { Route } from '../routes/route.ts';

import { compileRoute, isNull, isUndefined, naturalCompare } from '../../utils/index.ts';

/**
 * The outcome of matching a request against the route table.
 *
 * - `matched` carries the resolved route and the params captured from its pattern.
 * - `method-not-allowed` means the path matched but no route serves it; `allow` lists those that do.
 * - `not-found` means no route matched the path at all.
 */
export type RouteMatch =
  | {
      /**
       * Discriminator for a resolved route.
       */
      type: 'matched';

      /**
       * The route to invoke.
       */
      route: Route;

      /**
       * Params captured from the route pattern, keyed by name, URI-decoded.
       * A malformed percent-sequence is left as its raw matched substring.
       */
      params: RouteParams;
    }
  | {
      /**
       * Discriminator for a path that matched but serves no route for the request method.
       */
      type: 'method-not-allowed';

      /**
       * Methods the matched path does serve, for the `Allow` header.
       */
      allow: HTTPMethod[];
    }
  | {
      /**
       * Discriminator for a path that matched no route.
       */
      type: 'not-found';
    };

/**
 * A compiled route table.
 * Built once from the registry; `match` then runs per request.
 */
export interface Router {
  /**
   * Resolves a request method and URL path to a route.
   *
   * The path must be the URL pathname, with query and fragment already stripped.
   * Patterns are tried most-specific first: static segments beat named params, which beat catch-alls.
   * A method-agnostic route (no method suffix in its filename) answers any method.
   * A `HEAD` with no `HEAD` route is served by the path's `GET` route; the body is dropped on the wire.
   * Captured params are URI-decoded before they reach the handler.
   */
  match(method: HTTPMethod, path: string): RouteMatch;
}

interface PatternEntry {
  matcher: RouteMatcher;
  routes: Map<HTTPMethod | null, Route>;
}

/**
 * Compiles a route table from a flat list of routes.
 *
 * Each unique pattern is compiled once and shared across the methods registered on it.
 * Patterns are ranked by specificity at build time.
 * `match` then returns the most specific hit without re-sorting per request.
 *
 * @example
 * ```ts
 * const router = createRouter(Object.values(useRoutes().all()))
 *
 * router.match('GET', '/users/42')
 * // -> { type: 'matched', route, params: { id: '42' } }
 *
 * router.match('DELETE', '/users/42')
 * // -> { type: 'method-not-allowed', allow: ['GET', 'HEAD'] }
 *
 * router.match('GET', '/nope')
 * // -> { type: 'not-found' }
 * ```
 */
export function createRouter(routes: Iterable<Route>): Router {
  const byPattern = new Map<string, PatternEntry>();

  for (const route of routes) {
    const matcher = compileRoute(route.pattern);
    let entry = byPattern.get(matcher.pattern);
    if (isUndefined(entry)) {
      entry = { matcher, routes: new Map() };
      byPattern.set(matcher.pattern, entry);
    }
    entry.routes.set(route.method, route);
  }

  const entries = [...byPattern.values()].sort((a, b) =>
    compareSpecificity(a.matcher.pattern, b.matcher.pattern),
  );

  function match(method: HTTPMethod, path: string): RouteMatch {
    const allow = new Set<HTTPMethod>();

    for (const entry of entries) {
      const params = entry.matcher(path);
      if (isNull(params)) continue;

      const route =
        entry.routes.get(method) ??
        entry.routes.get(null) ??
        (method === 'HEAD' ? entry.routes.get('GET') : undefined);
      if (!isUndefined(route)) return { type: 'matched', route, params: decodeParams(params) };

      for (const m of entry.routes.keys()) if (!isNull(m)) allow.add(m);
    }

    if (allow.has('GET')) allow.add('HEAD');
    if (allow.size > 0) return { type: 'method-not-allowed', allow: [...allow].sort() };
    return { type: 'not-found' };
  }

  return { match };
}

function decodeParams(params: RouteParams): RouteParams {
  const out: RouteParams = {};
  for (const key in params) {
    const value = params[key];
    out[key] = value.includes('%') ? safeDecode(value) : value;
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function specificity(pattern: string): number[] {
  return pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith('[...')) return 0;
      if (segment.startsWith('[') || segment.startsWith(':')) return 1;
      return 2;
    });
}

function compareSpecificity(a: string, b: string): number {
  const sa = specificity(a);
  const sb = specificity(b);

  const shared = Math.min(sa.length, sb.length);
  for (let i = 0; i < shared; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i];
  }
  if (sa.length !== sb.length) return sb.length - sa.length;
  return naturalCompare(a, b);
}
