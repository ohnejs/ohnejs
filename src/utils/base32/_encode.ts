/**
 * Encodes `bytes` as base32 over `alphabet`, unpadded.
 *
 * @example
 * ```ts
 * encode(new TextEncoder().encode('f'), BASE32_ALPHABET)    // -> 'MY'
 * encode(new TextEncoder().encode('f'), CROCKFORD_ALPHABET) // -> 'CR'
 * ```
 */
export function encode(bytes: Uint8Array, alphabet: string): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}
