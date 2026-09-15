import { capitalize } from '../case/capitalize.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Attributes for a `Set-Cookie` header, serialized by `serializeCookie`.
 */
export interface SerializeCookieOptions {
  /**
   * Hosts the cookie is sent to, as the `Domain` attribute.
   */
  domain?: string;

  /**
   * URL path prefix the cookie is scoped to, as the `Path` attribute.
   */
  path?: string;

  /**
   * Absolute expiry, as the `Expires` attribute (formatted with `toUTCString`).
   */
  expires?: Date;

  /**
   * Lifetime in seconds, as the `Max-Age` attribute; takes precedence over `expires` in browsers.
   */
  maxAge?: number;

  /**
   * Hides the cookie from client-side scripts, as the `HttpOnly` attribute.
   *
   * @default
   * false
   */
  httpOnly?: boolean;

  /**
   * Restricts the cookie to HTTPS, as the `Secure` attribute.
   *
   * @default
   * false
   */
  secure?: boolean;

  /**
   * Cross-site sending policy, as the `SameSite` attribute.
   * A `'none'` value requires `secure`.
   */
  sameSite?: 'strict' | 'lax' | 'none';

  /**
   * Binds the cookie to the top-level site (CHIPS), as the `Partitioned` attribute.
   *
   * @default
   * false
   */
  partitioned?: boolean;

  /**
   * Retention priority under storage pressure, as the `Priority` attribute.
   */
  priority?: 'low' | 'medium' | 'high';
}

const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Throws when `value` holds a line break or `;`, either of which would inject into the header.
 */
function assertSafe(label: string, value: string): void {
  if (value.includes('\n') || value.includes('\r') || value.includes(';')) {
    throw new Error(`Invalid cookie ${label}: ${JSON.stringify(value)}`);
  }
}

/**
 * Serializes one `name`/`value` pair and its attributes into a `Set-Cookie` header value.
 * The value is `encodeURIComponent`-encoded, which also closes header injection through it.
 *
 * Throws on a name that is not a valid cookie token, or a `domain`/`path` carrying a newline or `;`.
 * Either would otherwise let a caller inject into the response header.
 *
 * @example
 * ```ts
 * serializeCookie('id', '42')
 * // -> 'id=42'
 *
 * serializeCookie('sid', 'abc', { httpOnly: true, sameSite: 'lax' })
 * // -> 'sid=abc; HttpOnly; SameSite=Lax'
 * ```
 */
export function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieOptions = {},
): string {
  if (!TOKEN.test(name)) throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`);

  let header = `${name}=${encodeURIComponent(value)}`;
  const { domain, path, expires, maxAge, httpOnly, secure, sameSite, partitioned, priority } =
    options;

  if (!isUndefined(maxAge)) header += `; Max-Age=${Math.floor(maxAge)}`;
  if (!isUndefined(domain)) {
    assertSafe('domain', domain);
    header += `; Domain=${domain}`;
  }
  if (!isUndefined(path)) {
    assertSafe('path', path);
    header += `; Path=${path}`;
  }
  if (!isUndefined(expires)) header += `; Expires=${expires.toUTCString()}`;
  if (secure) header += '; Secure';
  if (httpOnly) header += '; HttpOnly';
  if (!isUndefined(sameSite)) header += `; SameSite=${capitalize(sameSite)}`;
  if (partitioned) header += '; Partitioned';
  if (!isUndefined(priority)) header += `; Priority=${capitalize(priority)}`;
  return header;
}
