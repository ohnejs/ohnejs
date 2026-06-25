import { hmacTag } from './_tag.ts';

/**
 * Signs a value with an HMAC-SHA256 tag, returning `value.tag` with the tag base64url-encoded.
 * Recover the value with `unsignValue`, which rejects any tampering.
 *
 * The value is not hidden; it travels in plaintext and only its integrity is protected.
 *
 * A non-empty `context` binds the tag to a scope, such as a cookie name.
 * A value signed under one context fails to verify under another, blocking replay across slots.
 *
 * @example
 * ```ts
 * signValue('hi', secret)        // -> 'hi.' followed by a base64url HMAC tag
 * signValue('hi', secret, 'sid') // -> a different tag, valid only under context 'sid'
 * ```
 */
export function signValue(value: string, secret: string, context = ''): string {
  return `${value}.${hmacTag(value, secret, context)}`;
}
