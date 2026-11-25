import type { P256Keys } from './generate-vapid-keys.ts';

import { decodeBase64URL } from '../base64url/decode-base64url.ts';
import { encodeBase64URL } from '../base64url/encode-base64url.ts';

/**
 * Imports the private half of `keys` for `name`, ECDSA signing or ECDH key agreement.
 * The JWK form carries the curve point taken from the uncompressed public key.
 *
 * @example
 * ```ts
 * await importPrivateKey(await generateVAPIDKeys(), 'ECDSA') // -> CryptoKey for signing
 * ```
 */
export function importPrivateKey(keys: P256Keys, name: 'ECDH' | 'ECDSA'): Promise<CryptoKey> {
  const point = decodeBase64URL(keys.publicKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: encodeBase64URL(point.subarray(1, 33)),
    y: encodeBase64URL(point.subarray(33, 65)),
    d: keys.privateKey,
  };
  const usage = name === 'ECDSA' ? 'sign' : 'deriveBits';
  return crypto.subtle.importKey('jwk', jwk, { name, namedCurve: 'P-256' }, false, [usage]);
}
