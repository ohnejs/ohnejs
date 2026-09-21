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
let session: symbol | null = null;

/**
 * Installs the handler called when a non-auth route answers `401`, or uninstalls it with `null`.
 * A signed-in dashboard reaching a `401` means the session expired.
 * The layer's login popup registers here to reopen sign-in in place.
 * Every `/auth/` route is excluded: their `401`s are answers, not expiries.
 * So is a request sent while signed out, or before the user last signed in or out.
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
 * Opens a fresh session for the requests sent from now on, once a sign-in succeeds.
 * A `401` answers for the session its request was sent under, so one from an earlier session is no expiry.
 */
export function startSession(): void {
  session = Symbol('session');
}

/**
 * Closes the session as a sign-out begins, so no `401` counts as an expiry until the next sign-in.
 */
export function endSession(): void {
  session = null;
}

/**
 * The session a request is sent under, `null` while signed out.
 * Hand it back to `handleUnauthorized` with the answer.
 */
export function currentSession(): symbol | null {
  return session;
}

/**
 * Calls the installed unauthorized handler when an answer means the session expired.
 * `sentUnder` is the `currentSession` at send time; a request the session has since moved past is dropped.
 */
export function handleUnauthorized(status: number, path: string, sentUnder: symbol | null): void {
  const current = !isNull(session) && sentUnder === session;
  if (current && isSessionExpiry(status, path)) unauthorizedHandler?.();
}

/**
 * The request headers with `Accept-Language` set to `language`, unless the caller already set one.
 * Takes every form `fetch` accepts: a `Headers`, a `[name, value]` list, a record, or nothing.
 * Answers a fresh `Headers`; a given instance stays untouched.
 *
 * @example
 * ```ts
 * withAcceptLanguage(undefined, 'de').get('accept-language')                   // -> 'de'
 * withAcceptLanguage({ 'Accept-Language': 'en' }, 'de').get('accept-language') // -> 'en'
 * ```
 */
export function withAcceptLanguage(headers: RequestInit['headers'], language: string): Headers {
  const merged = new Headers(headers);
  if (!merged.has('accept-language')) merged.set('accept-language', language);
  return merged;
}
