import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeCBOR } from '../../../src/utils/cbor/decode-cbor.ts';
import {
  type AuthenticationResponseJSON,
  coseToJWK,
  parseAuthenticatorData,
  verifyWebAuthnAuthentication,
  verifyWebAuthnRegistration,
  type WebAuthnCredential,
} from '../../../src/utils/index.ts';
import { b64, FLAG, fakePasskey } from './_authenticator.ts';
import { SPEC, vector } from './_vectors.ts';

const LOOSE = { requireUserVerification: false };

/**
 * The credential a spec vector registers, read straight from its authenticator data.
 */
function specCredential(name: string): WebAuthnCredential {
  const { response } = vector(name).registration;
  const bytes = Uint8Array.fromBase64(response.response.attestationObject, {
    alphabet: 'base64url',
  });
  const authData = (decodeCBOR(bytes) as Map<string, Uint8Array>).get('authData')!;
  const { credential } = parseAuthenticatorData(authData);
  return { id: response.id, publicKey: coseToJWK(credential!.publicKey), signCount: 0 };
}

const signIn = (
  name: string,
  credential = specCredential(name),
  options: { requireUserVerification?: boolean } = LOOSE,
) => {
  const { challenge, response } = vector(name).authentication;
  return verifyWebAuthnAuthentication(response, credential, { ...SPEC, challenge, ...options });
};

const withResponse = (
  response: AuthenticationResponseJSON,
  edit: Partial<AuthenticationResponseJSON['response']>,
): AuthenticationResponseJSON => ({ ...response, response: { ...response.response, ...edit } });

describe('verifyWebAuthnAuthentication', () => {
  it('verifies the spec ES256 vectors against their registered credential', async () => {
    const { challenge, response } = vector('none.ES256').registration;
    const credential = await verifyWebAuthnRegistration(response, { ...SPEC, challenge, ...LOOSE });
    deepStrictEqual(await signIn('none.ES256', credential), {
      signCount: 0,
      userVerified: false,
      backedUp: true,
    });
    await signIn('packed-self.ES256');
    await signIn('longCredentialID');
  });

  it('verifies the spec RS256 and Ed25519 vectors', async () => {
    strictEqual((await signIn('packed.RS256')).signCount, 0);
    strictEqual((await signIn('packed.EdDSA')).backedUp, false);
  });

  it('rejects the spec vector whose client data is cross-origin', async () => {
    await rejects(signIn('crossOrigin'), /cross-origin/);
  });

  it('requires user verification by default', async () => {
    await rejects(signIn('none.ES256', undefined, {}), /not verified/);
  });

  it('rejects a signature from another credential', async () => {
    await rejects(
      signIn('none.ES256', {
        ...specCredential('none.ES256'),
        publicKey: specCredential('packed-self.ES256').publicKey,
      }),
      /Invalid WebAuthn signature/,
    );
  });

  it('rejects tampered authenticator data, client data or signature', async () => {
    const { challenge, response } = vector('packed-self.ES256').authentication;
    const credential = specCredential('packed-self.ES256');
    const expected = { ...SPEC, challenge, ...LOOSE };
    const flip = (text: string, at: number) => {
      const bytes = Uint8Array.fromBase64(text, { alphabet: 'base64url' });
      bytes[at] ^= 1;
      return b64(bytes);
    };
    const { authenticatorData, signature, clientDataJSON } = response.response;
    await rejects(
      verifyWebAuthnAuthentication(
        withResponse(response, { authenticatorData: flip(authenticatorData, 36) }),
        credential,
        expected,
      ),
      /Invalid WebAuthn signature/,
    );
    await rejects(
      verifyWebAuthnAuthentication(
        withResponse(response, { signature: flip(signature, 40) }),
        credential,
        expected,
      ),
      /Invalid WebAuthn signature/,
    );
    await rejects(
      verifyWebAuthnAuthentication(
        withResponse(response, { signature: flip(signature, 0) }),
        credential,
        expected,
      ),
      /Invalid DER/,
    );
    const padded = b64(
      Uint8Array.from([...Uint8Array.fromBase64(clientDataJSON, { alphabet: 'base64url' }), 0x20]),
    );
    await rejects(
      verifyWebAuthnAuthentication(
        withResponse(response, { clientDataJSON: padded }),
        credential,
        expected,
      ),
      /Invalid WebAuthn signature/,
    );
  });

  it('rejects a wrong challenge, origin, RP ID, type or id', async () => {
    const { challenge, response } = vector('packed-self.ES256').authentication;
    const credential = specCredential('packed-self.ES256');
    const other = b64(new Uint8Array(32));
    await rejects(
      verifyWebAuthnAuthentication(response, credential, { ...SPEC, challenge: other }),
      /challenge/,
    );
    await rejects(
      verifyWebAuthnAuthentication(response, credential, {
        ...SPEC,
        challenge,
        origin: 'https://example.com',
      }),
      /origin/,
    );
    await rejects(
      verifyWebAuthnAuthentication(response, credential, {
        ...SPEC,
        challenge,
        rpID: 'example.com',
        ...LOOSE,
      }),
      /RP ID/,
    );
    await rejects(
      verifyWebAuthnAuthentication({ ...response, type: 'other' }, credential, {
        ...SPEC,
        challenge,
      }),
      /type/,
    );
    await rejects(
      verifyWebAuthnAuthentication(response, { ...credential, id: other }, { ...SPEC, challenge }),
      /id does not match/,
    );
  });

  it('rejects a registration posted as a sign-in', async () => {
    const { challenge, response } = vector('packed-self.ES256').registration;
    const posed = {
      ...response,
      response: {
        clientDataJSON: response.response.clientDataJSON,
        authenticatorData: '',
        signature: '',
      },
    };
    await rejects(
      verifyWebAuthnAuthentication(posed, specCredential('packed-self.ES256'), {
        ...SPEC,
        challenge,
      }),
      /`webauthn.get`/,
    );
  });

  describe('a Safari-style synced passkey', () => {
    const passkey = fakePasskey();
    const expected = (challenge: string) => ({
      challenge,
      origin: 'https://example.com',
      rpID: 'example.com',
    });

    const enroll = async () => {
      const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
      return verifyWebAuthnRegistration(passkey.register(challenge), expected(challenge));
    };

    const use = (
      credential: WebAuthnCredential,
      options: { flags?: number; signCount?: number } = {},
    ) => {
      const challenge = b64(crypto.getRandomValues(new Uint8Array(32)));
      return verifyWebAuthnAuthentication(
        passkey.authenticate(challenge, options),
        credential,
        expected(challenge),
      );
    };

    it('signs in again and again with a counter of `0`', async () => {
      const credential = await enroll();
      for (let i = 0; i < 3; i++) {
        deepStrictEqual(await use(credential), {
          signCount: 0,
          userVerified: true,
          backedUp: true,
        });
      }
    });

    it('accepts a counter that grows', async () => {
      const credential = await enroll();
      strictEqual((await use(credential, { signCount: 1 })).signCount, 1);
      strictEqual((await use({ ...credential, signCount: 1 }, { signCount: 9 })).signCount, 9);
    });

    it('rejects a counter that does not grow, as a possible clone', async () => {
      const credential = { ...(await enroll()), signCount: 5 };
      await rejects(use(credential, { signCount: 5 }), /cloned/);
      await rejects(use(credential, { signCount: 3 }), /cloned/);
      await rejects(use(credential, { signCount: 0 }), /cloned/);
    });

    it('rejects a sign-in without the user present', async () => {
      await rejects(use(await enroll(), { flags: FLAG.UV }), /not present/);
    });
  });
});
