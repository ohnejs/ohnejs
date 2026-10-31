import type { TOTPOptions } from './totp-code.ts';

import { decodeBase32 } from '../base32/decode-base32.ts';
import { hotp } from './_hotp.ts';
import { secureCompare } from './secure-compare.ts';

/**
 * The options `verifyTOTP` takes: the code parameters plus the tolerated clock drift.
 */
export interface VerifyTOTPOptions extends TOTPOptions {
  /**
   * How many periods before and after `time` still match, absorbing clock drift and typing delay.
   *
   * @default
   * 1
   */
  window?: number;
}

/**
 * Checks a typed TOTP `code` against a base32 `secret`, comparing in constant time.
 * Returns the matched time step, or `undefined` when no step in the window matches.
 * Store the step and reject any later code at or below it, so one code never signs in twice.
 *
 * @example
 * ```ts
 * verifyTOTP('287082', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59_000 }) // -> 1
 * verifyTOTP('287082', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 89_000 }) // -> 1, one period late
 * verifyTOTP('000000', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59_000 }) // -> undefined
 * ```
 */
export function verifyTOTP(
  code: string,
  secret: string,
  {
    algorithm = 'sha1',
    digits = 6,
    period = 30,
    time = Date.now(),
    window = 1,
  }: VerifyTOTPOptions = {},
): number | undefined {
  const key = decodeBase32(secret);
  const current = Math.floor(time / 1000 / period);
  for (let step = current - window; step <= current + window; step++) {
    if (step >= 0 && secureCompare(code, hotp(key, step, algorithm, digits))) return step;
  }
  return undefined;
}
