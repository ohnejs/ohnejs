import type { DigestChallenge } from './parse-digest-challenge.ts';

import { isNull } from '../is/is-null.ts';
import { md5 } from './_md5.ts';
import { quotedString } from './_quoted-string.ts';

/**
 * What `digestAuthorization` answers a challenge with.
 */
export interface DigestInput {
  /**
   * The parsed challenge, from `parseDigestChallenge`.
   */
  challenge: DigestChallenge;

  /**
   * The method of the request being authorized, such as `'REGISTER'`.
   */
  method: string;

  /**
   * The request URI as sent, such as `'sip:127.0.0.1'`.
   */
  uri: string;

  /**
   * The account name.
   */
  username: string;

  /**
   * The account password.
   */
  password: string;

  /**
   * How many requests this client has sent with the challenge's nonce, starting at `1`.
   */
  nc: number;

  /**
   * A fresh client nonce, such as a random token.
   */
  cnonce: string;
}

const encoder = new TextEncoder();

/**
 * Computes the `Authorization` (or `Proxy-Authorization`) value answering a `Digest` challenge.
 * It speaks `SHA-256`, `MD5`, and their `-sess` variants, with `qop=auth` when offered.
 * A challenge without `qop` gets the RFC 2069 answer.
 * A client holding several challenges should answer the `SHA-256` one.
 *
 * Another algorithm, or a challenge offering only `auth-int`, throws.
 *
 * @example
 * ```ts
 * await digestAuthorization({
 *   challenge: parseDigestChallenge(sipHeader(response, 'WWW-Authenticate')!)!,
 *   method: 'REGISTER',
 *   uri: 'sip:127.0.0.1',
 *   username: 'owner',
 *   password,
 *   nc: 1,
 *   cnonce: crypto.randomUUID(),
 * })
 * // -> 'Digest username="owner", realm="asterisk", nonce="1732a7", uri="sip:127.0.0.1", ...'
 * ```
 */
export async function digestAuthorization(input: DigestInput): Promise<string> {
  const { challenge, method, uri, username, password, cnonce } = input;
  const algorithm = challenge.algorithm.toUpperCase();
  const hash = hasher(algorithm.replace(/-SESS$/, ''));
  const auth = challenge.qop.includes('auth');
  if (!auth && challenge.qop.length > 0) {
    throw new Error(`Unsupported digest qop: ${challenge.qop.join(', ')}`);
  }

  let secret = await hash(`${username}:${challenge.realm}:${password}`);
  if (algorithm.endsWith('-SESS')) secret = await hash(`${secret}:${challenge.nonce}:${cnonce}`);
  const target = await hash(`${method}:${uri}`);

  const nc = input.nc.toString(16).padStart(8, '0');
  const response = await hash(
    auth
      ? `${secret}:${challenge.nonce}:${nc}:${cnonce}:auth:${target}`
      : `${secret}:${challenge.nonce}:${target}`,
  );

  const fields = [
    `username=${quotedString(username)}`,
    `realm=${quotedString(challenge.realm)}`,
    `nonce=${quotedString(challenge.nonce)}`,
    `uri=${quotedString(uri)}`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (auth) fields.push(`cnonce=${quotedString(cnonce)}`, 'qop=auth', `nc=${nc}`);
  if (!isNull(challenge.opaque)) fields.push(`opaque=${quotedString(challenge.opaque)}`);
  return `Digest ${fields.join(', ')}`;
}

/**
 * The hex hash function for a base `algorithm`, `SHA-256` or `MD5`.
 */
function hasher(algorithm: string): (text: string) => Promise<string> {
  if (algorithm === 'SHA-256') {
    return async (text) =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))).toHex();
  }
  if (algorithm === 'MD5') return async (text) => md5(encoder.encode(text)).toHex();
  throw new Error(`Unsupported digest algorithm: ${algorithm}`);
}
