import { timingSafeEqual } from 'node:crypto';

import { isNull } from '../is/is-null.ts';
import { scryptDerive } from './_scrypt.ts';

/**
 * Verifies a password against a `scrypt$cost$blockSize$p$salt$hash` string from `hashPassword`.
 * The stored parameters drive the derivation, so an old hash still verifies after the cost is raised.
 * The comparison is constant-time, so its duration never reveals how close a wrong password was.
 *
 * A missing, malformed or unparseable stored hash never matches, so it returns `false`, never throws.
 *
 * @example
 * ```ts
 * const stored = await hashPassword('hunter2')
 * await verifyPassword('hunter2', stored) // -> true
 * await verifyPassword('wrong', stored)   // -> false
 * await verifyPassword('hunter2', null)   // -> false
 * ```
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (isNull(stored)) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length === 0) return false;

  try {
    const key = await scryptDerive(password, Buffer.from(parts[4], 'base64url'), expected.length, {
      cost,
      blockSize,
      parallelization,
    });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
