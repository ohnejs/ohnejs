import { createHmac } from 'node:crypto';

/**
 * Computes the HMAC-SHA256 tag of `value` under `secret`, base64url-encoded.
 * The tag is 43 characters, unpadded, and safe in URLs, cookies, and file names.
 *
 * `secret` is a string or raw key bytes, such as a key derived from another HMAC.
 *
 * @example
 * ```ts
 * hmac('what do ya want for nothing?', 'Jefe') // -> 'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM'
 * hmac('hi', 'secret')                         // -> 43-char base64url tag
 * ```
 */
export function hmac(value: string, secret: string | Uint8Array): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
