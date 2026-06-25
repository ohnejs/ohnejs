import { decodeText } from '../text/decode-text.ts';

/**
 * An `Authorization` header split into its scheme and credentials, per RFC 7235.
 * Basic credentials are additionally decoded into `username` and `password`.
 */
export interface Authorization {
  /**
   * The lowercased auth scheme (`'bearer'`, `'basic'`). Schemes are case-insensitive.
   */
  scheme: string;

  /**
   * The credentials following the scheme, verbatim: a bearer token, a base64 Basic blob, etc.
   */
  token: string;

  /**
   * The decoded Basic username, present only for a `basic` scheme whose `token` decodes.
   */
  username?: string;

  /**
   * The decoded Basic password, present only for a `basic` scheme whose `token` decodes.
   */
  password?: string;
}

function decodeBasic(token: string): Pick<Authorization, 'username' | 'password'> | null {
  let decoded: string;
  try {
    decoded = decodeText(Uint8Array.from(atob(token), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }

  const colon = decoded.indexOf(':');
  if (colon === -1) return null;

  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Parses an `Authorization` header into its scheme and credentials.
 * The scheme is lowercased for comparison; the token is kept verbatim.
 * Returns `null` when the header is blank or carries no credentials.
 *
 * A `basic` token is base64-decoded (UTF-8) and split on the first colon into `username` and `password`.
 * Both are omitted when the token is not valid base64 or holds no colon.
 *
 * @example
 * ```ts
 * parseAuthorization('Bearer abc.def')
 * // -> { scheme: 'bearer', token: 'abc.def' }
 *
 * parseAuthorization('Basic dXNlcjpwYXNz')
 * // -> { scheme: 'basic', token: 'dXNlcjpwYXNz', username: 'user', password: 'pass' }
 *
 * parseAuthorization('')
 * // -> null
 * ```
 */
export function parseAuthorization(header: string): Authorization | null {
  const match = /^(\S+)\s+(\S.*)$/.exec(header.trim());
  if (match === null) return null;

  const scheme = match[1].toLowerCase();
  const token = match[2];
  const auth: Authorization = { scheme, token };

  if (scheme === 'basic') {
    const credentials = decodeBasic(token);
    if (credentials !== null) Object.assign(auth, credentials);
  }

  return auth;
}
