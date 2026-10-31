import { createHmac } from 'node:crypto';

import type { TOTPAlgorithm } from './totp-code.ts';

/**
 * Computes the RFC 4226 one-time code for the moving factor `step` under `key`.
 * The code is zero-padded to `digits`.
 *
 * @example
 * ```ts
 * hotp(new TextEncoder().encode('12345678901234567890'), 0, 'sha1', 6) // -> '755224'
 * hotp(new TextEncoder().encode('12345678901234567890'), 1, 'sha1', 6) // -> '287082'
 * ```
 */
export function hotp(
  key: Uint8Array,
  step: number,
  algorithm: TOTPAlgorithm,
  digits: number,
): string {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const tag = createHmac(algorithm, key).update(counter).digest();
  const offset = tag[tag.length - 1]! & 0xf;
  const binary = tag.readUInt32BE(offset) & 0x7fff_ffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}
