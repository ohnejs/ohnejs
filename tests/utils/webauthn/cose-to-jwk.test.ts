import { deepStrictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { type CBORMap, decodeCBOR } from '../../../src/utils/cbor/decode-cbor.ts';
import { coseToJWK, parseAuthenticatorData } from '../../../src/utils/index.ts';
import { vector } from './_vectors.ts';

const coseKey = (name: string): CBORMap => {
  const { attestationObject } = vector(name).registration.response.response;
  const attestation = decodeCBOR(
    Uint8Array.fromBase64(attestationObject, { alphabet: 'base64url' }),
  );
  const authData = (attestation as Map<string, Uint8Array>).get('authData')!;
  return parseAuthenticatorData(authData).credential!.publicKey;
};

const b64 = (hex: string) =>
  Uint8Array.fromHex(hex).toBase64({ alphabet: 'base64url', omitPadding: true });

describe('coseToJWK', () => {
  it('converts the spec ES256 key', () => {
    deepStrictEqual(coseToJWK(coseKey('none.ES256')), {
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      x: b64('afefa16f97ca9b2d23eb86ccb64098d20db90856062eb249c33a9b672f26df61'),
      y: b64('930a56b87a2fca66334b03458abf879717c12cc68ed73290af2e2664796b9220'),
    });
  });

  it('converts the spec Ed25519 and RS256 keys', async () => {
    const ed = coseToJWK(coseKey('packed.EdDSA'));
    deepStrictEqual([ed.kty, ed.alg], ['OKP', 'EdDSA']);
    const rsa = coseToJWK(coseKey('packed.RS256'));
    deepStrictEqual([rsa.kty, rsa.alg, rsa.kty === 'RSA' && rsa.e], ['RSA', 'RS256', 'AQAB']);
    await crypto.subtle.importKey('jwk', ed, { name: 'Ed25519' }, false, ['verify']);
    await crypto.subtle.importKey(
      'jwk',
      rsa,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  });

  it('rejects other algorithms and mismatched parameters', () => {
    const p256 = coseKey('none.ES256');
    throws(() => coseToJWK(new Map([...p256, [3, -35]])), /algorithm `-35`/);
    throws(() => coseToJWK(new Map([...p256, [-1, 2]])), /algorithm `-7`/);
    throws(() => coseToJWK(new Map([...p256, [1, 1]])), /algorithm `-7`/);
    throws(() => coseToJWK(new Map([1, 2].map((k) => [k, 0]))), /algorithm `undefined`/);
  });

  it('rejects a missing or wrongly sized coordinate', () => {
    const p256 = coseKey('none.ES256');
    throws(() => coseToJWK(new Map([...p256, [-2, new Uint8Array(31)]])), /`-2` is not 32 bytes/);
    const missing = new Map(p256);
    missing.delete(-3);
    throws(() => coseToJWK(missing), /lacks parameter `-3`/);
  });
});
