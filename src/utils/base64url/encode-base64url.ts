/**
 * Encodes `bytes` as unpadded base64url, the form JWTs, WebAuthn and Web Push use.
 *
 * @example
 * ```ts
 * encodeBase64URL(new Uint8Array([251, 255])) // -> '-_8'
 * ```
 */
export function encodeBase64URL(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}
