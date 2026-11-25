import type { WebAuthnCredential } from './verify-webauthn-registration.ts';
import type { WebAuthnExpectation } from './webauthn-expectation.ts';

import { decodeBase64URL } from '../base64url/decode-base64url.ts';
import { checkAuthenticatorData } from './_check-authenticator-data.ts';
import { checkClientData } from './_client-data.ts';
import { verifySignature } from './_signature.ts';

/**
 * The JSON a browser's `PublicKeyCredential.toJSON()` gives for a sign-in.
 * Only the fields the verification reads are listed.
 */
export interface AuthenticationResponseJSON {
  /**
   * The credential id, base64url.
   */
  id: string;

  /**
   * Always `'public-key'`.
   */
  type: string;

  /**
   * The authenticator's response.
   */
  response: {
    /**
     * The client data, base64url.
     */
    clientDataJSON: string;

    /**
     * The authenticator data, base64url.
     */
    authenticatorData: string;

    /**
     * The signature over the authenticator data and the client data hash, base64url.
     */
    signature: string;
  };
}

/**
 * A verified sign-in.
 */
export interface WebAuthnAuthentication {
  /**
   * The new signature counter, to store on the credential.
   */
  signCount: number;

  /**
   * The authenticator verified the user.
   */
  userVerified: boolean;

  /**
   * The credential is synced right now.
   */
  backedUp: boolean;
}

/**
 * Verifies a WebAuthn sign-in against the stored `credential`.
 * It checks the credential id, the client data, the RP ID hash, the flags and the signature.
 * A counter of `0` on both sides passes, as synced passkeys never count.
 * Any other counter that does not grow throws, as the credential may be cloned.
 *
 * @example
 * ```ts
 * await verifyWebAuthnAuthentication(body, credential, {
 *   challenge,
 *   origin: 'https://example.com',
 *   rpID: 'example.com',
 * })
 * // -> { signCount: 0, userVerified: true, backedUp: true }
 * ```
 */
export async function verifyWebAuthnAuthentication(
  response: AuthenticationResponseJSON,
  credential: WebAuthnCredential,
  expected: WebAuthnExpectation,
): Promise<WebAuthnAuthentication> {
  if (response.type !== 'public-key') throw new Error('Credential type is not `public-key`');
  if (response.id !== credential.id) throw new Error('Credential id does not match');
  const clientDataHash = await checkClientData(decodeBase64URL(response.response.clientDataJSON), {
    ...expected,
    type: 'webauthn.get',
  });

  const authData = decodeBase64URL(response.response.authenticatorData);
  const data = await checkAuthenticatorData(authData, expected);
  const signature = decodeBase64URL(response.response.signature);
  if (!(await verifySignature(credential.publicKey, signature, authData, clientDataHash))) {
    throw new Error('Invalid WebAuthn signature');
  }

  const { signCount } = data;
  if ((signCount !== 0 || credential.signCount !== 0) && signCount <= credential.signCount) {
    throw new Error('Signature counter did not grow, the credential may be cloned');
  }
  return {
    signCount,
    userVerified: data.flags.userVerified,
    backedUp: data.flags.backedUp,
  };
}
