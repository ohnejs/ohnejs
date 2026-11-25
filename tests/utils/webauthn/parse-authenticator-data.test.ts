import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeCBOR } from '../../../src/utils/cbor/decode-cbor.ts';
import { parseAuthenticatorData } from '../../../src/utils/index.ts';
import { encodeCBOR, FLAG } from './_authenticator.ts';
import { vector } from './_vectors.ts';

const registrationAuthData = (name: string) => {
  const { attestationObject } = vector(name).registration.response.response;
  const attestation = decodeCBOR(
    Uint8Array.fromBase64(attestationObject, { alphabet: 'base64url' }),
  );
  return (attestation as Map<string, Uint8Array>).get('authData')!;
};

const header = (flags: number, signCount = 0) => {
  const bytes = new Uint8Array(37);
  bytes[32] = flags;
  new DataView(bytes.buffer).setUint32(33, signCount);
  return bytes;
};

describe('parseAuthenticatorData', () => {
  it('parses the spec ES256 registration', () => {
    const data = parseAuthenticatorData(registrationAuthData('none.ES256'));
    strictEqual(
      data.rpIDHash.toHex(),
      'bfabc37432958b063360d3ad6461c9c4735ae7f8edd46592a5e0f01452b2e4b5',
    );
    deepStrictEqual(data.flags, {
      userPresent: true,
      userVerified: false,
      backupEligible: true,
      backedUp: true,
      attestedCredentialData: true,
      extensionData: false,
    });
    strictEqual(data.signCount, 0);
    strictEqual(data.credential?.aaguid, '8446ccb9-ab1d-b374-750b-2367ff6f3a1f');
    strictEqual(
      data.credential.id.toHex(),
      'f91f391db4c9b2fde0ea70189cba3fb63f579ba6122b33ad94ff3ec330084be4',
    );
    strictEqual(data.credential.publicKey.get(3), -7);
    strictEqual(data.extensions, undefined);
  });

  it('parses a credential id near the maximum length', () => {
    const data = parseAuthenticatorData(registrationAuthData('longCredentialID'));
    strictEqual(data.credential?.id.byteLength, 1023);
  });

  it('parses an assertion without a credential', () => {
    const data = parseAuthenticatorData(header(FLAG.UP | FLAG.UV, 7));
    strictEqual(data.signCount, 7);
    strictEqual(data.credential, undefined);
  });

  it('reads the signature counter as unsigned', () => {
    strictEqual(parseAuthenticatorData(header(FLAG.UP, 0xffffffff)).signCount, 4294967295);
  });

  it('parses extension outputs', () => {
    const extensions = encodeCBOR(new Map([['credProtect', 2]]));
    const data = parseAuthenticatorData(
      Uint8Array.from([...header(FLAG.UP | FLAG.ED), ...extensions]),
    );
    deepStrictEqual(data.extensions, new Map([['credProtect', 2]]));
  });

  it('rejects BS without BE', () => {
    throws(() => parseAuthenticatorData(header(FLAG.UP | FLAG.BS)), /backup eligible/);
  });

  it('rejects data shorter than its flags promise', () => {
    throws(() => parseAuthenticatorData(new Uint8Array(36)), /too short/);
    throws(() => parseAuthenticatorData(header(FLAG.UP | FLAG.AT)), /too short/);
    throws(() => parseAuthenticatorData(header(FLAG.UP | FLAG.ED)), /ends early/);
  });

  it('rejects a credential id longer than the data or than 1023 bytes', () => {
    const at = (length: number) =>
      Uint8Array.from([...header(FLAG.AT), ...new Uint8Array(16), length >> 8, length & 0xff]);
    throws(() => parseAuthenticatorData(at(4)), /credential id length/);
    throws(
      () => parseAuthenticatorData(Uint8Array.from([...at(1024), ...new Uint8Array(1100)])),
      /credential id length/,
    );
  });

  it('rejects a public key that is not a map', () => {
    const bytes = Uint8Array.from([...header(FLAG.AT), ...new Uint8Array(16), 0, 1, 0xaa, 0x01]);
    throws(() => parseAuthenticatorData(bytes), /COSE key/);
  });

  it('rejects trailing bytes', () => {
    throws(() => parseAuthenticatorData(Uint8Array.from([...header(FLAG.UP), 0])), /Trailing/);
    const authData = registrationAuthData('none.ES256');
    throws(() => parseAuthenticatorData(Uint8Array.from([...authData, 0xa0])), /Trailing/);
  });
});
