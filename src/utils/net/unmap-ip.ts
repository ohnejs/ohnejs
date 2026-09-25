import { isIPv6, SocketAddress } from 'node:net';

const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

/**
 * Every spelling of a mapped address holds this group, so an address without it needs no parsing.
 */
const FFFF = /ffff/i;

/**
 * Normalizes an IPv4-mapped IPv6 address to its plain IPv4 form, leaving any other address unchanged.
 * Every spelling of `::ffff:0:0/96` unmaps, hex and dotted alike, whatever its case or zero compression.
 *
 * A dual-stack socket reports an IPv4 client as `'::ffff:127.0.0.1'`.
 * This returns `'127.0.0.1'`, so the address reads and compares as IPv4.
 *
 * @example
 * ```ts
 * unmapIP('::ffff:127.0.0.1')         // -> '127.0.0.1'
 * unmapIP('::ffff:7f00:1')            // -> '127.0.0.1'
 * unmapIP('0:0:0:0:0:ffff:a9fe:a9fe') // -> '169.254.169.254'
 * unmapIP('::ffff:0:7f00:1')          // -> '::ffff:0:7f00:1'
 * unmapIP('127.0.0.1')                // -> '127.0.0.1'
 * unmapIP('fd00::1')                  // -> 'fd00::1'
 * ```
 */
export function unmapIP(ip: string): string {
  const dotted = MAPPED.exec(ip);
  if (dotted) return dotted[1];
  if (!FFFF.test(ip) || !isIPv6(ip)) return ip;
  // The canonical text of a mapped address always ends in its dotted IPv4.
  const mapped = MAPPED.exec(new SocketAddress({ address: ip, family: 'ipv6' }).address);
  return mapped ? mapped[1] : ip;
}
