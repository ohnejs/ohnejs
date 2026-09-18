import { createHash } from 'node:crypto';

/**
 * Hashes a raw session token into the form the `Sessions` row stores: its sha256, base64url-encoded.
 * A lookup hashes the incoming cookie token and matches it against the stored hash, never the raw token.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
