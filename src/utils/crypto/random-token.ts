import { randomBytes } from 'node:crypto';

/**
 * Generates a cryptographically random token, base64url-encoded.
 * `size` is a count of random bytes; the token is longer, about `size * 4 / 3` characters.
 *
 * The base64url alphabet is URL- and cookie-safe and unpadded, so the token needs no escaping.
 * Suitable for session ids, CSRF tokens, and nonces.
 *
 * @example
 * ```ts
 * randomToken()   // -> 43-char base64url string (32 random bytes)
 * randomToken(16) // -> 22-char base64url string (16 random bytes)
 * ```
 */
export function randomToken(size = 32): string {
  return randomBytes(size).toString('base64url');
}
