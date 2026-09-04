import { isNull } from '../../utils/is/is-null.ts';
import { parseRouteID } from '../../utils/route/parse-route-id.ts';

/**
 * Where a route id sends a request.
 */
export interface RequestTarget {
  /**
   * The method the id names, absent for a bare path.
   */
  method?: string;

  /**
   * The root-relative path, as the id spells it.
   */
  path: string;

  /**
   * The absolute URL: the path appended to the API base URL.
   */
  url: string;
}

let unauthorizedHandler: (() => void) | null = null;

/**
 * Installs the handler called when a non-auth route answers `401`, or uninstalls it with `null`.
 * A signed-in dashboard reaching a `401` means the session expired.
 * The layer's login popup registers here to reopen sign-in in place.
 * Every `/auth/` route is excluded: their `401`s are answers, not expiries.
 * The anonymous session probe and a wrong login both speak through their own surfaces.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/**
 * Resolves a route id against an API base URL.
 * A leading method is parsed off; the rest is the path, appended to `apiURL` as is.
 *
 * @example
 * ```ts
 * requestTarget('http://localhost:3000', 'GET /authors')
 * // -> { method: 'GET', path: '/authors', url: 'http://localhost:3000/authors' }
 * ```
 */
export function requestTarget(apiURL: string, route: string): RequestTarget {
  const parsed = parseRouteID(route);
  return { ...parsed, url: `${apiURL}${parsed.path}` };
}

/**
 * Whether an answer means the session expired: a `401` from any route outside `/auth/`.
 */
export function isSessionExpiry(status: number, path: string): boolean {
  return status === 401 && !path.startsWith('/auth/');
}

/**
 * Calls the installed unauthorized handler when an answer means the session expired.
 */
export function handleUnauthorized(status: number, path: string): void {
  if (isSessionExpiry(status, path) && !isNull(unauthorizedHandler)) unauthorizedHandler();
}
