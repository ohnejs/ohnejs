import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeCBOR } from '../../../src/utils/cbor/decode-cbor.ts';
import { verifyWebAuthnRegistration } from '../../../src/utils/index.ts';
import { b64, encodeCBOR, FLAG, fakePasskey } from './_authenticator.ts';
import { SPEC, vector } from './_vectors.ts';

const register = (name: string, options: { requireUserVerification?: boolean } = {}) => {
  const { challenge, response } = vector(name).registration;
  return verifyWebAuthnRegistration(response, { ...SPEC, challenge, ...options });
};

const withAttestation = (name: string, edit: (attestation: Map<string, unknown>) => void) => {
  const { challenge, response } = vector(name).registration;
  const bytes = Uint8Array.fromBase64(response.response.attestationObject, {
    alphabet: 'base64url',
  });
  const attestation = new Map(decodeCBOR(bytes) as Map<string, unknown>);
  edit(attestation);
  const attestationObject = b64(encodeCBOR(attestation as never));
  return {
    challenge,
    response: { ...response, response: { ...response.response, attestationObject } },
  };
};

describe('verifyWebAuthnRegistration', () => {
  it('verifies the spec ES256 vector with no attestation', async () => {
    const credential = await register('none.ES256', { requireUserVerification: false });
    strictEqual(
      credential.id,
      b64(Uint8Array.fromHex('f91f391db4c9b2fde0ea70189cba3fb63f579ba6122b33ad94ff3ec330084be4')),
    );
    strictEqual(credential.publicKey.alg, 'ES256');
    strictEqual(credential.signCount, 0);
    strictEqual(credential.aaguid, '8446ccb9-ab1d-b374-750b-2367ff6f3a1f');
    deepStrictEqual(
      [credential.userVerified, credential.backupEligible, credential.backedUp],
      [false, true, true],
    );
  });

  it('verifies the spec ES256 vector with packed self-attestation', async () => {
    const credential = await register('packed-self.ES256');
    strictEqual(credential.userVerified, true);
  });

  it('verifies the spec vector with a 1023-byte credential id', async () => {
    await register('longCredentialID', { requireUserVerification: false });
  });

  it('requires user verification by default', async () => {
    await rejects(register('none.ES256'), /not verified/);
  });

  it('rejects client data marked cross-origin', async () => {
    await rejects(register('crossOrigin', { requireUserVerification: false }), /cross-origin/);
    await rejects(register('topOrigin', { requireUserVerification: false }), /cross-origin/);
  });

  it('rejects attestation with a certificate chain', async () => {
    await rejects(
      register('packed.RS256', { requireUserVerification: false }),
      /Unsupported attestation format `packed`/,
    );
    await rejects(
      register('packed.EdDSA', { requireUserVerification: false }),
      /Unsupported attestation format `packed`/,
    );
  });

  it('rejects a tampered packed self-attestation', async () => {
    const tampered = withAttestation('packed-self.ES256', (attestation) => {
      const statement = new Map(attestation.get('attStmt') as Map<string, unknown>);
      const sig = (statement.get('sig') as Uint8Array).slice();
      sig[10] ^= 1;
      statement.set('sig', sig);
      attestation.set('attStmt', statement);
    });
    await rejects(
      verifyWebAuthnRegistration(tampered.response, { ...SPEC, challenge: tampered.challenge }),
      /signature/,
    );
  });

  it('rejects a packed self-attestation whose algorithm differs from the key', async () => {
    const mismatched = withAttestation('packed-self.ES256', (attestation) => {
      const statement = new Map(attestation.get('attStmt') as Map<string, unknown>);
      statement.set('alg', -257);
      attestation.set('attStmt', statement);
    });
    await rejects(
      verifyWebAuthnRegistration(mismatched.response, { ...SPEC, challenge: mismatched.challenge }),
      /Invalid packed/,
    );
  });

  it('rejects a `none` statement that is not empty', async () => {
    const filled = withAttestation('none.ES256', (attestation) => {
      attestation.set('attStmt', new Map([['sig', new Uint8Array(8)]]));
    });
    await rejects(
      verifyWebAuthnRegistration(filled.response, {
        ...SPEC,
        challenge: filled.challenge,
        requireUserVerification: false,
      }),
      /Unsupported attestation format `none`/,
    );
  });

  it('rejects a wrong challenge, origin, RP ID, type or id', async () => {
    const { challenge, response } = vector('packed-self.ES256').registration;
    const other = b64(new Uint8Array(32));
    await rejects(verifyWebAuthnRegistration(response, { ...SPEC, challenge: other }), /challenge/);
    await rejects(
      verifyWebAuthnRegistration(response, { ...SPEC, challenge, origin: 'https://evil.example' }),
      /origin/,
    );
    await rejects(
      verifyWebAuthnRegistration(response, { ...SPEC, challenge, rpID: 'evil.example' }),
      /RP ID/,
    );
    await rejects(
      verifyWebAuthnRegistration({ ...response, type: 'other' }, { ...SPEC, challenge }),
      /type/,
    );
    await rejects(
      verifyWebAuthnRegistration({ ...response, id: other }, { ...SPEC, challenge }),
      /id does not match/,
    );
  });

  it('rejects an assertion posted as a registration', async () => {
    const { challenge, response } = vector('packed-self.ES256').authentication;
    const posed = {
      ...response,
      response: { clientDataJSON: response.response.clientDataJSON, attestationObject: '' },
    };
    await rejects(verifyWebAuthnRegistration(posed, { ...SPEC, challenge }), /`webauthn.create`/);
  });

  it('accepts any of several allowed origins', async () => {
    const { challenge, response } = vector('packed-self.ES256').registration;
    await verifyWebAuthnRegistration(response, {
      ...SPEC,
      challenge,
      origin: ['https://example.com', SPEC.origin],
    });
  });

  it('verifies a Safari-style synced passkey', async () => {
    const passkey = fakePasskey();
    const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
    const credential = await verifyWebAuthnRegistration(passkey.register(challenge), {
      challenge,
      origin: 'https://example.com',
      rpID: 'example.com',
    });
    strictEqual(credential.id, passkey.id);
    strictEqual(credential.aaguid, '00000000-0000-0000-0000-000000000000');
    deepStrictEqual(
      [credential.signCount, credential.backupEligible, credential.backedUp],
      [0, true, true],
    );
  });

  it('rejects a registration without the user present', async () => {
    const passkey = fakePasskey();
    const challenge = b64(new Uint8Array(32));
    const response = passkey.register(challenge, { flags: FLAG.UV | FLAG.AT });
    await rejects(
      verifyWebAuthnRegistration(response, {
        challenge,
        origin: 'https://example.com',
        rpID: 'example.com',
      }),
      /not present/,
    );
  });

  it('rejects a registration without a credential', async () => {
    const passkey = fakePasskey();
    const challenge = b64(new Uint8Array(32));
    const response = passkey.register(challenge, { flags: FLAG.UP | FLAG.UV });
    await rejects(
      verifyWebAuthnRegistration(response, {
        challenge,
        origin: 'https://example.com',
        rpID: 'example.com',
      }),
      /lacks the new credential/,
    );
  });
});
