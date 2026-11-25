import type { PublicKeyJWK } from './cose-to-jwk.ts';

import { concatBytes } from '../bytes/concat-bytes.ts';
import { derToP1363 } from './_der-signature.ts';

const ALGORITHMS = {
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
  EdDSA: { import: { name: 'Ed25519' }, verify: { name: 'Ed25519' } },
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
} as const;

/**
 * Imports `jwk` for verifying, which also rejects a key that is not on its curve.
 */
export function importPublicKey(jwk: PublicKeyJWK): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ALGORITHMS[jwk.alg].import, false, ['verify']);
}

/**
 * Verifies a WebAuthn `signature` over `authData || clientDataHash`, DER-encoded for ES256.
 */
export async function verifySignature(
  jwk: PublicKeyJWK,
  signature: Uint8Array,
  authData: Uint8Array,
  clientDataHash: Uint8Array,
): Promise<boolean> {
  const key = await importPublicKey(jwk);
  const raw = jwk.alg === 'ES256' ? derToP1363(signature, 32) : signature.slice();
  const signed = concatBytes(authData, clientDataHash);
  return crypto.subtle.verify(ALGORITHMS[jwk.alg].verify, key, raw, signed);
}
