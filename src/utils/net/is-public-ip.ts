import { createCIDRMatcher } from './create-cidr-matcher.ts';

/**
 * IPv4 blocks the IANA special-purpose registry marks not globally reachable, plus multicast and reserved.
 * `240.0.0.0/4` holds the limited broadcast address.
 */
const SPECIAL_IPV4: [address: string, bits: number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/**
 * Blocks inside `2000::/3` that are not global unicast: IETF protocol assignments, documentation, 6to4.
 * `::ffff:0:0/96` never belongs here: `BlockList` reads it as all of IPv4, so it would refuse every address.
 */
const SPECIAL_IPV6 = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'];

/**
 * Global unicast space, with the NAT64 prefix so a DNS64 host keeps working.
 * `0.0.0.0/0` also covers every IPv4-mapped address, which `BlockList` reads as its IPv4.
 */
const isGlobal = createCIDRMatcher(['0.0.0.0/0', '2000::/3', '64:ff9b::/96']);

/**
 * Every special block, each IPv4 one twinned inside `64:ff9b::/96` so a NAT64 address is judged by its IPv4.
 */
const isSpecial = createCIDRMatcher([
  ...SPECIAL_IPV4.flatMap(([address, bits]) => [
    `${address}/${bits}`,
    `64:ff9b::${address}/${96 + bits}`,
  ]),
  ...SPECIAL_IPV6,
]);

/**
 * Whether `ip` is a globally routable unicast address, safe to connect to on someone else's behalf.
 * It must be IPv4, global unicast `2000::/3`, or NAT64 `64:ff9b::/96`.
 * It must lie outside every IANA special-purpose block.
 * That covers private, loopback, link-local, shared, documentation, benchmarking, multicast, reserved.
 * An IPv4-mapped or NAT64 address is judged by the IPv4 address it embeds.
 * Other IPv4 embeddings are refused whole: compatible, translated, 6to4, Teredo, and local-use NAT64.
 * A zone id, brackets, a non-canonical IPv4 form, or anything that is not an address is refused.
 *
 * @example
 * ```ts
 * isPublicIP('8.8.8.8')            // -> true
 * isPublicIP('2606:4700::1111')    // -> true
 * isPublicIP('::ffff:808:808')     // -> true
 * isPublicIP('10.0.0.1')           // -> false
 * isPublicIP('::ffff:7f00:1')      // -> false
 * isPublicIP('64:ff9b::a9fe:a9fe') // -> false
 * isPublicIP('fe80::1%en0')        // -> false
 * isPublicIP('localhost')          // -> false
 * ```
 */
export function isPublicIP(ip: string): boolean {
  return !ip.includes('%') && isGlobal(ip) && !isSpecial(ip);
}
