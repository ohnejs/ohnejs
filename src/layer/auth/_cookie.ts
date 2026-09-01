import { deleteCookie, setCookie, useAuthorization, useCookies } from 'ohne';
import { isNull, isUndefined } from 'ohne/utils';

import { useAuthConfig } from './config.ts';

/**
 * Reads the request's session token: the session cookie, or a `Bearer` token when the cookie is absent.
 * Returns `null` when neither carries one, so a browser cookie and an API client's header both work.
 */
export function readSessionToken(): string | null {
  const cookie = useCookies()[useAuthConfig().cookieName];
  if (!isUndefined(cookie)) return cookie;

  const authorization = useAuthorization();
  return !isNull(authorization) && authorization.scheme === 'bearer' ? authorization.token : null;
}

/**
 * Writes the session cookie with the safe session profile: `HttpOnly`, `Secure`, `SameSite=Lax`, root path.
 * `maxAge` is the cookie's lifetime in milliseconds, rounded down to the seconds the header carries.
 * Omitting it writes a cookie without `Max-Age`, one that ends with the browser session.
 */
export function writeSessionCookie(token: string, maxAge?: number): void {
  setCookie(useAuthConfig().cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: isUndefined(maxAge) ? undefined : Math.floor(maxAge / 1000),
  });
}

/**
 * Clears the session cookie, scoped to the same root path it was set with.
 */
export function clearSessionCookie(): void {
  deleteCookie(useAuthConfig().cookieName, { path: '/' });
}
