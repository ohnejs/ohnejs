/**
 * Hashes a string to an unsigned 32-bit integer with FNV-1a over its UTF-16 code units.
 * The same text always lands on the same number, so it picks stable buckets: a color slot, a shard.
 * It is not cryptographic; never use it where a collision would be a security issue.
 *
 * @example
 * ```ts
 * hashText('hello')      // -> 1335831723
 * hashText('')           // -> 2166136261
 * hashText('Thrall') % 8 // -> 0
 * ```
 */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}
