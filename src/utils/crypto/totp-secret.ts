import { randomBytes } from 'node:crypto';

import { encodeBase32 } from '../base32/encode-base32.ts';

/**
 * Generates a random TOTP secret, base32-encoded as authenticator apps expect.
 * `size` is a count of random bytes; the default 20 is the 160 bits RFC 4226 recommends.
 *
 * @example
 * ```ts
 * totpSecret()   // -> 32-char base32 string (20 random bytes)
 * totpSecret(32) // -> 52-char base32 string (32 random bytes)
 * ```
 */
export function totpSecret(size = 20): string {
  return encodeBase32(randomBytes(size));
}
