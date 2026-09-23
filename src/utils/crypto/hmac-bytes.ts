import { createHmac } from 'node:crypto';

/**
 * Computes the raw HMAC-SHA256 of `value` under `key`.
 * Reach for it when the tag feeds another HMAC as its key, as key derivation chains do.
 * `hmac` returns the same tag base64url-encoded.
 *
 * @example
 * ```ts
 * hmacBytes('what do ya want for nothing?', 'Jefe').toHex()
 * // -> '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
 *
 * hmacBytes('region', hmacBytes('date', 'secret'))
 * // -> a 32-byte key derived in two steps
 * ```
 */
export function hmacBytes(value: string, key: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(value).digest());
}
