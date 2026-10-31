import { decodeBase32 } from '../base32/decode-base32.ts';
import { hotp } from './_hotp.ts';

/**
 * A hash algorithm a TOTP code is computed with.
 */
export type TOTPAlgorithm = 'sha1' | 'sha256' | 'sha512';

/**
 * The parameters of a TOTP code, each optional and defaulting to what authenticator apps assume.
 */
export interface TOTPOptions {
  /**
   * The HMAC hash algorithm.
   *
   * @default
   * 'sha1'
   */
  algorithm?: TOTPAlgorithm;

  /**
   * The number of digits in a code.
   *
   * @default
   * 6
   */
  digits?: number;

  /**
   * The seconds each code stays current.
   *
   * @default
   * 30
   */
  period?: number;

  /**
   * The moment the code is for, in milliseconds since the epoch.
   *
   * @default
   * Date.now()
   */
  time?: number;
}

/**
 * Computes the RFC 6238 time-based one-time code for a base32 `secret`.
 * It matches what an authenticator app shows for the same secret at the same moment.
 *
 * @example
 * ```ts
 * totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59_000 })            // -> '287082'
 * totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59_000, digits: 8 }) // -> '94287082'
 * totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')                              // -> the current 6-digit code
 * ```
 */
export function totpCode(
  secret: string,
  { algorithm = 'sha1', digits = 6, period = 30, time = Date.now() }: TOTPOptions = {},
): string {
  return hotp(decodeBase32(secret), Math.floor(time / 1000 / period), algorithm, digits);
}
