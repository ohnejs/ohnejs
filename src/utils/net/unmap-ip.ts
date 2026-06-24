const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Normalizes an IPv4-mapped IPv6 address to its plain IPv4 form, leaving any other address unchanged.
 *
 * A dual-stack socket reports an IPv4 client as `'::ffff:127.0.0.1'`.
 * This returns `'127.0.0.1'`, so the address reads and compares as IPv4.
 * Anything that is not IPv4-mapped is returned as-is.
 *
 * @example
 * ```ts
 * unmapIP('::ffff:127.0.0.1') // -> '127.0.0.1'
 * unmapIP('127.0.0.1')        // -> '127.0.0.1'
 * unmapIP('fd00::1')          // -> 'fd00::1'
 * ```
 */
export function unmapIP(ip: string): string {
  const mapped = MAPPED.exec(ip);
  return mapped ? mapped[1] : ip;
}
