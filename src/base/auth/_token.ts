import { digest } from 'ohnejs/utils/crypto';

/**
 * Hashes a raw session token into the form the `Sessions` row stores: its sha256, base64url-encoded.
 * A lookup hashes the incoming cookie token and matches it against the stored hash, never the raw token.
 */
export function hashSessionToken(token: string): string {
  return digest('sha256', token).toBase64({ alphabet: 'base64url', omitPadding: true });
}
