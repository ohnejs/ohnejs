import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two strings in constant time, so the duration never reveals where they first differ.
 * Returns `false` at once when the lengths differ; equal-length inputs are compared byte by byte.
 *
 * Use it for secrets, HMAC tags, and tokens, where a plain `===` would leak timing.
 *
 * @example
 * ```ts
 * secureCompare('abc', 'abc') // -> true
 * secureCompare('abc', 'abd') // -> false
 * ```
 */
export function secureCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
