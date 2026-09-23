import { createHash } from 'node:crypto';

/**
 * A hash algorithm `digest` computes.
 */
export type DigestAlgorithm = 'md5' | 'sha1' | 'sha256';

/**
 * Hashes `data` with `algorithm`, returning the raw digest bytes.
 * Encode the result with `toHex()` or `toBase64()` for the form a caller needs.
 *
 * @example
 * ```ts
 * digest('sha256', '').toHex()    // -> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 * digest('md5', 'abc').toBase64() // -> 'kAFQmDzST7DWlj99KOF/cg=='
 * ```
 */
export function digest(algorithm: DigestAlgorithm, data: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash(algorithm).update(data).digest());
}
