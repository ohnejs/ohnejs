/**
 * Decodes base64url `text`, padded or not.
 *
 * @example
 * ```ts
 * decodeBase64URL('-_8') // -> Uint8Array [251, 255]
 * ```
 */
export function decodeBase64URL(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.fromBase64(text, { alphabet: 'base64url' });
}
