import type { HashPasswordOptions } from './hash-password.ts';

/**
 * Whether a `hashPassword` string carries different scrypt parameters than `options` describes.
 * `true` calls for a rehash on the next successful sign-in, so stored hashes follow a raised cost.
 * A malformed stored string is `true`: whatever produced it, it was not the current parameters.
 *
 * @example
 * ```ts
 * const stored = await hashPassword('hunter2', { cost: 32768 })
 * passwordNeedsRehash(stored, { cost: 32768 }) // -> false
 * passwordNeedsRehash(stored, { cost: 65536 }) // -> true
 * ```
 */
export function passwordNeedsRehash(stored: string, options: HashPasswordOptions = {}): boolean {
  const { cost = 32_768, blockSize = 8, parallelization = 1 } = options;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return (
    Number(parts[1]) !== cost ||
    Number(parts[2]) !== blockSize ||
    Number(parts[3]) !== parallelization
  );
}
