import { createHash } from 'node:crypto';

/**
 * Caps a name at `max` characters, marking truncation with a hash of the full name.
 * A name at or under the cap passes through unchanged, so re-feeding output is idempotent.
 * Over the cap, the head is kept and `$` plus the first 8 hex chars of the name's sha256 fill the tail.
 * The hash covers the entire untruncated name, so names differing only past the cut stay distinct.
 *
 * The default cap of 63 is the tightest common identifier limit across SQL databases.
 * A cap below 9 cannot fit the marker; the result is then the bare 9-char `$`-hash.
 *
 * @example
 * ```ts
 * truncateWithHash('idx_orders_customer')
 * // -> 'idx_orders_customer'
 *
 * truncateWithHash('idx_' + 'categories'.repeat(8))
 * // -> 'idx_categoriescategoriescategoriescategoriescategories$b560e838'
 * ```
 */
export function truncateWithHash(name: string, max = 63): string {
  if (name.length <= max) {
    return name;
  }
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, Math.max(0, max - 9))}$${hash}`;
}
