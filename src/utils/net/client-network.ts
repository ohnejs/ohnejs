import { isIPv6 } from 'node:net';

import { ipPrefix } from './ip-prefix.ts';

/**
 * The network a client IP is counted under: its `/64` for IPv6, the address itself otherwise.
 * One device usually owns a whole `/64`, so switching addresses inside it stays one client.
 *
 * @example
 * ```ts
 * clientNetwork('2001:db8:1:2::7') // -> '2001:db8:1:2::/64'
 * clientNetwork('203.0.113.7')     // -> '203.0.113.7'
 * clientNetwork('')                // -> ''
 * ```
 */
export function clientNetwork(ip: string): string {
  return isIPv6(ip) ? ipPrefix(ip, 64) : ip;
}
