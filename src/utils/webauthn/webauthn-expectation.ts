/**
 * What a WebAuthn ceremony must match, from the server's side.
 */
export interface WebAuthnExpectation {
  /**
   * The challenge the server issued for this ceremony, base64url.
   */
  challenge: string;

  /**
   * The origin the page runs on, such as `'https://example.com'`, or every origin allowed.
   */
  origin: string | readonly string[];

  /**
   * The RP ID the credential is scoped to, such as `'example.com'`.
   */
  rpID: string;

  /**
   * Whether the authenticator must have verified the user, by biometrics or a PIN.
   *
   * @default
   * true
   */
  requireUserVerification?: boolean;
}
