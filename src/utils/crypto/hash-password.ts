import { randomBytes } from 'node:crypto';

import { scryptDerive } from './_scrypt.ts';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * The scrypt cost `hashPassword` uses, each field optional and defaulting to a recommended value.
 */
export interface HashPasswordOptions {
  /**
   * The scrypt CPU/memory cost; must be a power of two.
   *
   * @default
   * 32768
   */
  cost?: number;

  /**
   * The scrypt block size.
   *
   * @default
   * 8
   */
  blockSize?: number;

  /**
   * The scrypt parallelization factor.
   *
   * @default
   * 1
   */
  parallelization?: number;
}

/**
 * Hashes a password with scrypt, returning a self-describing `scrypt$cost$blockSize$p$salt$hash` string.
 * The salt is random per call, so the same password hashes differently every time.
 * Recover a yes/no match with `verifyPassword`; the cost parameters travel in the string.
 *
 * The salt and derived key are base64url-encoded; `$` never appears in that alphabet.
 *
 * @example
 * ```ts
 * await hashPassword('hunter2')
 * // -> 'scrypt$32768$8$1$<16-byte salt>$<64-byte hash>', base64url
 *
 * await hashPassword('hunter2', { cost: 65536 })
 * // -> 'scrypt$65536$8$1$...', a costlier, slower hash
 * ```
 */
export async function hashPassword(
  password: string,
  { cost = 32_768, blockSize = 8, parallelization = 1 }: HashPasswordOptions = {},
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptDerive(password, salt, KEY_LENGTH, { cost, blockSize, parallelization });
  return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
