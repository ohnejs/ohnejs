import { BASE32_ALPHABET } from './_alphabet.ts';

const INVALID = /[^A-Z2-7]/i;
const WHITESPACE = /\s+/g;
const PADDING = /=+$/;

/**
 * Decodes RFC 4648 base32 into bytes.
 * Lowercase letters, whitespace, and trailing `=` padding are accepted, as hand-typed secrets need.
 * Throws on a character outside the alphabet or a length no encoding produces.
 *
 * @example
 * ```ts
 * decodeBase32('MZXW6YTBOI')         // -> bytes of 'foobar'
 * decodeBase32('mzxw 6ytb oi======') // -> bytes of 'foobar'
 * decodeBase32('MZXW1')              // -> throws, `1` is not base32
 * ```
 */
export function decodeBase32(text: string): Uint8Array {
  const chars = text.replace(WHITESPACE, '').replace(PADDING, '');
  const invalid = INVALID.exec(chars);
  if (invalid) throw new Error(`Invalid base32 character \`${invalid[0]}\``);
  if ([1, 3, 6].includes(chars.length % 8))
    throw new Error(`Invalid base32 length \`${chars.length}\``);
  const out = new Uint8Array(Math.floor((chars.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of chars.toUpperCase()) {
    buffer = ((buffer << 5) | BASE32_ALPHABET.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >>> bits) & 255;
    }
  }
  return out;
}
