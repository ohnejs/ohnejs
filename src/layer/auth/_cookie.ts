import { deleteCookie, setCookie, useAuthorization, useCookies } from 'ohne';
import { isNull, isUndefined, parseDuration } from 'ohne/utils';

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
 * The `Max-Age` follows `auth.sessionMaxAge`, so the cookie expires with the session it names.
 */
export function writeSessionCookie(token: string): void {
  const { cookieName, sessionMaxAge } = useAuthConfig();
  setCookie(cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(parseDuration(sessionMaxAge) / 1000),
  });
}

/**
 * Clears the session cookie, scoped to the same root path it was set with.
 */
export function clearSessionCookie(): void {
  deleteCookie(useAuthConfig().cookieName, { path: '/' });
}
