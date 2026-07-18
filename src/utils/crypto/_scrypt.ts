import { scrypt } from 'node:crypto';

/**
 * scrypt cost parameters: CPU/memory cost, block size, and parallelization.
 */
export interface ScryptParams {
  cost: number;
  blockSize: number;
  parallelization: number;
}

/**
 * Derives a `keylen`-byte key from `password` and `salt` with scrypt, over Node's callback form.
 * `maxmem` is raised to fit the cost, since Node otherwise caps scrypt memory at 32 MiB.
 * Shared by `hashPassword` and `verifyPassword`, so deriving never diverges between them.
 *
 * @example
 * ```ts
 * const key = await scryptDerive('pw', salt, 64, { cost: 32768, blockSize: 8, parallelization: 1 })
 * key.length // -> 64
 * ```
 */
export function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  { cost, blockSize, parallelization }: ScryptParams,
): Promise<Buffer> {
  const maxmem = Math.max(33_554_432, 256 * cost * blockSize);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { cost, blockSize, parallelization, maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
