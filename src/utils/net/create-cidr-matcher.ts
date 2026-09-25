import { BlockList, isIP, isIPv6 } from 'node:net';

import { unmapIP } from './unmap-ip.ts';

const PREFIX = /^\d{1,3}$/;

/**
 * Builds a predicate that tests whether an IP falls in any of the given CIDR ranges.
 *
 * The ranges are parsed once into a `node:net` `BlockList`, so the returned predicate is cheap per call.
 * Each entry is a bare address (`'10.0.0.1'`) or a CIDR block (`'10.0.0.0/8'`), IPv4 or IPv6.
 * An IPv4-mapped IPv6 address (`'::ffff:127.0.0.1'`) is normalized to its IPv4 form before testing.
 * That lets it match an IPv4 range.
 * An empty list matches nothing; a malformed address tests as `false`.
 * An entry whose prefix is not plain decimal digits throws, since `Number('')` would read it as `/0`.
 *
 * @example
 * ```ts
 * const trusted = createCIDRMatcher(['10.0.0.0/8', '127.0.0.1'])
 * trusted('10.1.2.3')        // -> true
 * trusted('127.0.0.1')       // -> true
 * trusted('::ffff:10.1.2.3') // -> true
 * trusted('8.8.8.8')         // -> false
 * trusted('nonsense')        // -> false
 *
 * createCIDRMatcher([])('10.1.2.3') // -> false
 * ```
 */
export function createCIDRMatcher(cidrs: string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const slash = cidr.indexOf('/');
    if (slash === -1) {
      list.addAddress(cidr, isIPv6(cidr) ? 'ipv6' : 'ipv4');
    } else {
      const address = cidr.slice(0, slash);
      const prefix = cidr.slice(slash + 1);
      if (!PREFIX.test(prefix)) throw new Error(`Invalid CIDR prefix in \`${cidr}\``);
      list.addSubnet(address, Number(prefix), isIPv6(address) ? 'ipv6' : 'ipv4');
    }
  }

  return (ip) => {
    const address = unmapIP(ip);
    if (isIP(address) === 0) return false;
    return list.check(address, isIPv6(address) ? 'ipv6' : 'ipv4');
  };
}
