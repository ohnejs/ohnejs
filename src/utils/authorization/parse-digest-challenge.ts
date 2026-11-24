import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { parseAuthorization } from './parse-authorization.ts';

/**
 * A `Digest` challenge from a `WWW-Authenticate` or `Proxy-Authenticate` header, per RFC 7616.
 */
export interface DigestChallenge {
  /**
   * The protection space the credentials belong to.
   */
  realm: string;

  /**
   * The server's nonce, echoed back in the answer.
   */
  nonce: string;

  /**
   * The hash algorithm, uppercased, such as `'SHA-256'`; `'MD5'` when the challenge names none.
   */
  algorithm: string;

  /**
   * The offered quality-of-protection values, lowercased; `[]` asks for the RFC 2069 answer.
   */
  qop: string[];

  /**
   * The opaque value to echo back unchanged, or `null` when the server sent none.
   */
  opaque: string | null;

  /**
   * Whether the previous nonce merely expired, so the same credentials may be retried.
   */
  stale: boolean;
}

/**
 * Parses a `Digest` challenge into its realm, nonce, algorithm, and options.
 * Returns `null` for another scheme or a challenge without a realm or nonce.
 * Quoted values are unwrapped, honoring backslash escapes, so a `,` inside quotes survives.
 *
 * @example
 * ```ts
 * parseDigestChallenge('Digest realm="pbx", nonce="1a", algorithm=SHA-256, qop="auth"')
 * // -> { realm: 'pbx', nonce: '1a', algorithm: 'SHA-256', qop: ['auth'], opaque: null, stale: false }
 *
 * parseDigestChallenge('Basic realm="x"')
 * // -> null
 * ```
 */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const auth = parseAuthorization(header);
  if (isNull(auth) || auth.scheme !== 'digest') return null;

  const params = readParams(auth.token);
  const realm = params.get('realm');
  const nonce = params.get('nonce');
  if (isUndefined(realm) || isUndefined(nonce)) return null;

  return {
    realm,
    nonce,
    algorithm: (params.get('algorithm') ?? 'MD5').toUpperCase(),
    qop: (params.get('qop') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== ''),
    opaque: params.get('opaque') ?? null,
    stale: params.get('stale')?.toLowerCase() === 'true',
  };
}

/**
 * Reads comma-separated `name=value` auth-params, lowercasing names and keeping the first of each.
 */
function readParams(text: string): Map<string, string> {
  const params = new Map<string, string>();
  let i = 0;

  while (i < text.length) {
    while (i < text.length && (text[i] === ',' || text[i] === ' ' || text[i] === '\t')) i++;

    const nameStart = i;
    while (i < text.length && text[i] !== '=' && text[i] !== ',') i++;
    const name = text.slice(nameStart, i).trim().toLowerCase();
    if (text[i] !== '=') continue;
    i++;
    while (text[i] === ' ' || text[i] === '\t') i++;

    let value = '';
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i++;
        value += text[i++];
      }
      i++;
    } else {
      const valueStart = i;
      while (i < text.length && text[i] !== ',') i++;
      value = text.slice(valueStart, i).trim();
    }

    if (name !== '' && !params.has(name)) params.set(name, value);
  }

  return params;
}
