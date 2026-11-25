import type { WebAuthnExpectation } from './webauthn-expectation.ts';

import { type AuthenticatorData, parseAuthenticatorData } from './parse-authenticator-data.ts';

const encoder = new TextEncoder();

/**
 * Parses `authData` and checks its RP ID hash and its user presence and verification flags.
 */
export async function checkAuthenticatorData(
  authData: Uint8Array,
  expected: WebAuthnExpectation,
): Promise<AuthenticatorData> {
  const data = parseAuthenticatorData(authData);
  const rpIDHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(expected.rpID)),
  );
  if (data.rpIDHash.toHex() !== rpIDHash.toHex()) throw new Error('RP ID hash does not match');
  if (!data.flags.userPresent) throw new Error('User was not present');
  if ((expected.requireUserVerification ?? true) && !data.flags.userVerified) {
    throw new Error('User was not verified');
  }
  return data;
}
