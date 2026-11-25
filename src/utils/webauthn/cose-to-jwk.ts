import type { CBORMap } from '../cbor/decode-cbor.ts';

import { encodeBase64URL } from '../base64url/encode-base64url.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * A credential public key as a JWK, ready for `crypto.subtle.importKey` or for storage as JSON.
 */
export type PublicKeyJWK =
  | { kty: 'EC'; crv: 'P-256'; alg: 'ES256'; x: string; y: string }
  | { kty: 'OKP'; crv: 'Ed25519'; alg: 'EdDSA'; x: string }
  | { kty: 'RSA'; alg: 'RS256'; n: string; e: string };

/**
 * Converts a COSE public key into a JWK.
 * Supports ES256 (`-7`, P-256), EdDSA (`-8`, Ed25519) and RS256 (`-257`).
 * A key of another algorithm, or one whose parameters do not match its algorithm, throws.
 *
 * @example
 * ```ts
 * const { credential } = parseAuthenticatorData(authData)
 * coseToJWK(credential.publicKey) // -> { kty: 'EC', crv: 'P-256', alg: 'ES256', x: 'f83O...', y: 'x_FE...' }
 * ```
 */
export function coseToJWK(key: CBORMap): PublicKeyJWK {
  const alg = key.get(3);
  const kty = key.get(1);
  if (alg === -7 && kty === 2 && key.get(-1) === 1) {
    return { kty: 'EC', crv: 'P-256', alg: 'ES256', x: part(key, -2, 32), y: part(key, -3, 32) };
  }
  if (alg === -8 && kty === 1 && key.get(-1) === 6) {
    return { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', x: part(key, -2, 32) };
  }
  if (alg === -257 && kty === 3) {
    return { kty: 'RSA', alg: 'RS256', n: part(key, -1), e: part(key, -2) };
  }
  throw new Error(`Unsupported COSE key with algorithm \`${String(alg)}\``);
}

/**
 * The byte string at `label` in `key` as base64url, checked against `size` when given.
 */
function part(key: CBORMap, label: number, size?: number): string {
  const value = key.get(label);
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`COSE key lacks parameter \`${label}\``);
  }
  if (!isUndefined(size) && value.byteLength !== size) {
    throw new Error(`COSE key parameter \`${label}\` is not ${size} bytes`);
  }
  return encodeBase64URL(value);
}
