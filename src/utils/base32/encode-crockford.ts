import { CROCKFORD_ALPHABET } from './_alphabet.ts';
import { encode } from './_encode.ts';

/**
 * Encodes `bytes` as Crockford base32, uppercase, unpadded and without a check symbol.
 * Read it back from typed input with `normalizeCrockford`.
 *
 * @example
 * ```ts
 * encodeCrockford(new TextEncoder().encode('f'))      // -> 'CR'
 * encodeCrockford(new TextEncoder().encode('foobar')) // -> 'CSQPYRK1E8'
 * ```
 */
export function encodeCrockford(bytes: Uint8Array): string {
  return encode(bytes, CROCKFORD_ALPHABET);
}
