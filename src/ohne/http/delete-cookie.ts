import type { SerializeCookieOptions } from '../../utils/index.ts';

import { setCookie } from './set-cookie.ts';

/**
 * Clears a cookie by setting it to expire immediately (`Max-Age=0`).
 * Valid only within a request.
 *
 * Pass the same `domain`/`path` the cookie was set with; a browser only clears a matching cookie.
 *
 * @example
 * ```ts
 * export default defineHandler(() => {
 *   deleteCookie('session', { path: '/' })
 *   return { ok: true }
 * })
 * ```
 */
export function deleteCookie(
  name: string,
  options?: Pick<SerializeCookieOptions, 'domain' | 'path'>,
): void {
  setCookie(name, '', { ...options, maxAge: 0 });
}
