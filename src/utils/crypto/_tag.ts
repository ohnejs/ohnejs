import { createHmac } from 'node:crypto';

/**
 * Computes the base64url HMAC-SHA256 tag for `value` under `secret`.
 * A non-empty `context` is folded into a derived key first, so the tag is bound to that context.
 * It cannot be replayed in another, such as a different cookie name.
 *
 * Shared by `signValue` and `unsignValue` so signing and verifying never diverge.
 *
 * @example
 * ```ts
 * hmacTag('hi', 'secret', '')     // -> 43-char base64url tag
 * hmacTag('hi', 'secret', 'role') // -> a different tag, bound to 'role'
 * ```
 */
export function hmacTag(value: string, secret: string, context: string): string {
  const key = context ? createHmac('sha256', secret).update(context).digest() : secret;
  return createHmac('sha256', key).update(value).digest('base64url');
}
