import { BASE32_ALPHABET } from './_alphabet.ts';
import { encode } from './_encode.ts';

/**
 * Encodes `bytes` as RFC 4648 base32, uppercase and unpadded.
 *
 * @example
 * ```ts
 * encodeBase32(new TextEncoder().encode('f'))      // -> 'MY'
 * encodeBase32(new TextEncoder().encode('foobar')) // -> 'MZXW6YTBOI'
 * ```
 */
export function encodeBase32(bytes: Uint8Array): string {
  return encode(bytes, BASE32_ALPHABET);
}
