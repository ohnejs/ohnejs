import type { WebAuthnExpectation } from './webauthn-expectation.ts';

import { decodeBase64URL } from '../base64url/decode-base64url.ts';
import { encodeBase64URL } from '../base64url/encode-base64url.ts';
import { type CBORMap, decodeCBOR } from '../cbor/decode-cbor.ts';
import { isMap } from '../is/is-map.ts';
import { checkAuthenticatorData } from './_check-authenticator-data.ts';
import { checkClientData } from './_client-data.ts';
import { importPublicKey, verifySignature } from './_signature.ts';
import { coseToJWK, type PublicKeyJWK } from './cose-to-jwk.ts';

/**
 * The JSON a browser's `PublicKeyCredential.toJSON()` gives for a new credential.
 * Only the fields the verification reads are listed.
 */
export interface RegistrationResponseJSON {
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
     * The attestation object, base64url.
     */
    attestationObject: string;

    /**
     * How the browser can reach the authenticator, such as `'internal'` or `'usb'`.
     * Store them to pass back in `allowCredentials`.
     */
    transports?: string[];
  };
}

/**
 * A credential to store, as both ceremonies need it.
 */
export interface WebAuthnCredential {
  /**
   * The credential id, base64url.
   */
  id: string;

  /**
   * The credential public key.
   */
  publicKey: PublicKeyJWK;

  /**
   * The highest signature counter seen so far.
   */
  signCount: number;
}

/**
 * A verified new credential.
 */
export interface RegisteredCredential extends WebAuthnCredential {
  /**
   * The authenticator model as a UUID.
   */
  aaguid: string;

  /**
   * The authenticator verified the user.
   */
  userVerified: boolean;

  /**
   * The credential may be synced to other devices.
   */
  backupEligible: boolean;

  /**
   * The credential is synced right now.
   */
  backedUp: boolean;
}

/**
 * Verifies a WebAuthn registration and returns the credential to store.
 * It checks the client data, the RP ID hash, the flags and the public key.
 * Attestation is accepted as `none` or packed self-attestation, and never trusted.
 * Request `attestation: 'none'`, since any other format throws.
 *
 * @example
 * ```ts
 * const credential = await verifyWebAuthnRegistration(body, {
 *   challenge,
 *   origin: 'https://example.com',
 *   rpID: 'example.com',
 * })
 * // -> { id: 'mJ3...', publicKey: { kty: 'EC', ... }, signCount: 0, backupEligible: true, ... }
 * ```
 */
export async function verifyWebAuthnRegistration(
  response: RegistrationResponseJSON,
  expected: WebAuthnExpectation,
): Promise<RegisteredCredential> {
  if (response.type !== 'public-key') throw new Error('Credential type is not `public-key`');
  const clientDataHash = await checkClientData(decodeBase64URL(response.response.clientDataJSON), {
    ...expected,
    type: 'webauthn.create',
  });

  const attestation = decodeCBOR(decodeBase64URL(response.response.attestationObject));
  if (!isMap(attestation)) throw new Error('Attestation object is not a map');
  const authData = attestation.get('authData');
  const attStmt = attestation.get('attStmt');
  if (!(authData instanceof Uint8Array) || !isMap<CBORMap>(attStmt)) {
    throw new Error('Attestation object lacks `authData` or `attStmt`');
  }

  const data = await checkAuthenticatorData(authData, expected);
  const { credential } = data;
  if (!credential) throw new Error('Authenticator data lacks the new credential');
  const id = encodeBase64URL(credential.id);
  if (id !== response.id) throw new Error('Credential id does not match the authenticator data');

  const publicKey = coseToJWK(credential.publicKey);
  await importPublicKey(publicKey);
  await checkAttestation(attestation.get('fmt'), attStmt, credential.publicKey, publicKey, {
    authData,
    clientDataHash,
  });

  return {
    id,
    publicKey,
    signCount: data.signCount,
    aaguid: credential.aaguid,
    userVerified: data.flags.userVerified,
    backupEligible: data.flags.backupEligible,
    backedUp: data.flags.backedUp,
  };
}

/**
 * Accepts a `none` statement, or a packed self-attestation signed by the new credential itself.
 */
async function checkAttestation(
  fmt: unknown,
  attStmt: CBORMap,
  cose: CBORMap,
  publicKey: PublicKeyJWK,
  signed: { authData: Uint8Array; clientDataHash: Uint8Array },
): Promise<void> {
  if (fmt === 'none' && attStmt.size === 0) return;
  if (fmt !== 'packed' || attStmt.has('x5c')) {
    throw new Error(`Unsupported attestation format \`${String(fmt)}\``);
  }
  const sig = attStmt.get('sig');
  if (attStmt.get('alg') !== cose.get(3) || !(sig instanceof Uint8Array)) {
    throw new Error('Invalid packed self-attestation');
  }
  if (!(await verifySignature(publicKey, sig, signed.authData, signed.clientDataHash))) {
    throw new Error('Invalid packed self-attestation signature');
  }
}
