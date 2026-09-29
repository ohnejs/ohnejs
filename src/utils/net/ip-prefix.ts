import { isIP, SocketAddress } from 'node:net';

import { isEmpty } from '../is/is-empty.ts';
import { isInteger } from '../is/is-integer.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { clamp } from '../number/clamp.ts';

/**
 * Masks an IP to its first `bits`, returning the network as CIDR text.
 * Every spelling of one network yields the same text, whatever its case or zero compression.
 *
 * A malformed IP, or `bits` outside the address width, throws.
 *
 * @example
 * ```ts
 * ipPrefix('2001:db8:1:2:aaaa::1', 64) // -> '2001:db8:1:2::/64'
 * ipPrefix('2001:DB8:1:2::ffff', 64)   // -> '2001:db8:1:2::/64'
 * ipPrefix('203.0.113.7', 24)          // -> '203.0.113.0/24'
 * ```
 */
export function ipPrefix(ip: string, bits: number): string {
  const family = isIP(ip);
  if (family === 0) throw new Error(`Invalid IP: ${ip}`);
  const size = family === 4 ? 8 : 16;
  const words = family === 4 ? ip.split('.').map(Number) : ipv6Words(ip);
  if (!isInteger(bits) || bits < 0 || bits > words.length * size)
    throw new Error(`Invalid prefix length: ${bits}`);

  const masked = words.map((word, i) => {
    const kept = clamp(bits - i * size, 0, size);
    return word & (((1 << size) - 1) ^ ((1 << (size - kept)) - 1));
  });
  if (family === 4) return `${masked.join('.')}/${bits}`;
  const address = masked.map((word) => word.toString(16)).join(':');
  return `${new SocketAddress({ address, family: 'ipv6' }).address}/${bits}`;
}

/**
 * Expands a valid IPv6 address into its eight 16-bit groups.
 */
function ipv6Words(ip: string): number[] {
  const [head, tail] = ip.split('%')[0].split('::');
  const left = groups(head);
  if (isUndefined(tail)) return left;
  const right = groups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/**
 * Parses one side of a `::` into 16-bit groups, splitting a dotted IPv4 tail into two.
 */
function groups(side: string): number[] {
  if (isEmpty(side)) return [];
  return side.split(':').flatMap((group) => {
    if (!group.includes('.')) return [Number.parseInt(group, 16)];
    const [a, b, c, d] = group.split('.').map(Number);
    return [(a << 8) | b, (c << 8) | d];
  });
}
