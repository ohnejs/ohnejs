import type { SerializeCookieOptions } from '../../utils/index.ts';

import { signValue } from '../../utils/crypto/index.ts';
import { cookieSecrets } from './_cookie-secret.ts';
import { setCookie } from './set-cookie.ts';

/**
 * Signs `value` and writes it as a `Set-Cookie` header, bound to the cookie `name`.
 * The signing secret comes from the `COOKIE_SECRET` env var; `useSignedCookies` recovers the value.
 * Valid only within a request.
 *
 * Defaults to `httpOnly`, `secure`, and `sameSite: 'lax'`, the safe profile for a session cookie.
 * The value is signed, not encrypted; it still travels in plaintext, so never sign a secret.
 *
 * @example
 * ```ts
 * export default defineHandler(() => {
 *   setSignedCookie('session', userId)
 *   return { ok: true }
 * })
 * ```
 */
export function setSignedCookie(
  name: string,
  value: string,
  options?: SerializeCookieOptions,
): void {
  const signed = signValue(value, cookieSecrets()[0], name);
  setCookie(name, signed, { httpOnly: true, secure: true, sameSite: 'lax', ...options });
}
