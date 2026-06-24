import { type SerializeCookieOptions, serializeCookie } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

/**
 * Appends a `Set-Cookie` header to the response for `name`/`value`.
 * Serializes through `serializeCookie`, so the value is encoded and attributes are formatted.
 * Valid only within a request.
 *
 * Call it once per cookie; each call adds its own header.
 *
 * @example
 * ```ts
 * export default defineHandler(() => {
 *   setCookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax' })
 *   return { ok: true }
 * })
 * ```
 */
export function setCookie(name: string, value: string, options?: SerializeCookieOptions): void {
  useEvent().response.headers.append('Set-Cookie', serializeCookie(name, value, options));
}
