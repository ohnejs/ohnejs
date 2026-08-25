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
 * A persistent cookie carries a `Max-Age` from `auth.sessionMaxAge`, so it expires with the session it names.
 * A non-persistent one omits `Max-Age` and ends with the browser session, for a login without remember me.
 */
export function writeSessionCookie(token: string, persistent = true): void {
  const { cookieName, sessionMaxAge } = useAuthConfig();
  setCookie(cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: persistent ? Math.floor(parseDuration(sessionMaxAge) / 1000) : undefined,
  });
}

/**
 * Clears the session cookie, scoped to the same root path it was set with.
 */
export function clearSessionCookie(): void {
  deleteCookie(useAuthConfig().cookieName, { path: '/' });
}
