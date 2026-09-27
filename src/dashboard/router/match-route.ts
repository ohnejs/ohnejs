import type { PageRoute } from '../../utils/route/page-route.ts';

import { isNull } from '../../utils/is/is-null.ts';
import {
  compileRoute,
  type RouteMatcher,
  type RouteParams,
} from '../../utils/route/compile-route.ts';
import { decodeRouteParams } from '../../utils/route/decode-route-params.ts';
import { canonicalPath } from '../../utils/uri/canonical-path.ts';

/**
 * A manifest entry compiled for matching.
 */
export interface CompiledPage {
  /**
   * Matches a location path against this entry's pattern, returning its params or `null`.
   */
  matcher: RouteMatcher;

  /**
   * The `import()`-ready served URL of the page module.
   */
  url: string;
}

/**
 * A resolved page match returned by `matchPages`.
 */
export interface MatchedRoute {
  /**
   * The `import()`-ready served URL of the matched page module.
   */
  url: string;

  /**
   * The route params captured from the path, URI-decoded.
   */
  params: RouteParams;

  /**
   * The location path that matched.
   */
  path: string;
}

/**
 * Compiles a page manifest into matchers, preserving its most-specific-first order.
 */
export function compilePages(manifest: readonly PageRoute[]): CompiledPage[] {
  return manifest.map((page) => ({ matcher: compileRoute(page.pattern), url: page.url }));
}

/**
 * Matches `path` against the compiled pages, first match wins, returning the match or `null`.
 * Params are URI-decoded, matching the server router.
 * The path is canonicalized first, as the server does, so `/%70osts` is `/posts`.
 * A path with an encoded slash matches nothing.
 */
export function matchPages(pages: readonly CompiledPage[], path: string): MatchedRoute | null {
  const canonical = canonicalPath(path);
  if (isNull(canonical)) return null;
  for (const page of pages) {
    const params = page.matcher(canonical);
    if (!isNull(params)) {
      return { url: page.url, params: decodeRouteParams(params), path: canonical };
    }
  }
  return null;
}
