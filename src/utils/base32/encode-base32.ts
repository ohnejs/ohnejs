import { BASE32_ALPHABET } from './_alphabet.ts';

/**
 * Encodes `bytes` as RFC 4648 base32, uppercase and unpadded.
 * The alphabet survives case-insensitive and hand-typed transport, as authenticator secrets need.
 *
 * @example
 * ```ts
 * encodeBase32(new TextEncoder().encode('f'))      // -> 'MY'
 * encodeBase32(new TextEncoder().encode('foobar')) // -> 'MZXW6YTBOI'
 * ```
 */
export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}
