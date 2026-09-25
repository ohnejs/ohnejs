import type { LookupAddress } from 'node:dns';
import type { Resolver } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { networkInterfaces } from 'node:os';

import { fetchPublicError } from './_fetch-public-error.ts';
import { createCIDRMatcher } from './create-cidr-matcher.ts';
import { isPublicIP } from './is-public-ip.ts';

/**
 * Ports a public destination may be reached on.
 */
const PORTS = new Set([80, 443]);

/**
 * Public addresses that lead into the host's own platform: Azure's wire server, bare and through NAT64.
 */
const PLATFORM = ['168.63.129.16', '64:ff9b::a83f:8110'];

/**
 * Builds the destination policy of one fetch: per connection, whether an address may be reached on its port.
 * An address inside `allow` is admitted on any port.
 * Any other must be public, on port 80 or 443, off the host's own networks, and not a platform address.
 * Each connection reads the host's networks once, so a long DNS answer costs one read, not one per address.
 *
 * @example
 * ```ts
 * const admits = createAdmit(['10.0.0.0/8'])
 * admits(8080)('10.1.2.3') // -> true
 * admits(443)('8.8.8.8')   // -> true
 * admits(6379)('8.8.8.8')  // -> false
 * admits(80)('127.0.0.1')  // -> false
 * ```
 */
export function createAdmit(allow: string[]): (port: number) => (ip: string) => boolean {
  const allowed = createCIDRMatcher(allow);
  return (port) => {
    const hostLocal = hostLocalMatcher();
    return (ip) => allowed(ip) || (PORTS.has(port) && isPublicIP(ip) && !hostLocal(ip));
  };
}

/**
 * A `lookup` for `net` that resolves both families through `resolver` and hands back only admitted answers.
 * One refused address refuses the whole answer, so neither happy eyeballs nor a mixed answer can reach it.
 * It hands over the first address of each family, so a long answer never turns one connection into a scan.
 * An answer with no address is `unreachable`: an empty list would crash `net`.
 * It answers in the shape `net` asks for, the list under `all`, else the first address.
 *
 * @example
 * ```ts
 * const lookup = guardedLookup(new Resolver(), createAdmit([])(443))
 * https.request({ host: 'example.com', lookup, agent: false })
 * ```
 */
export function guardedLookup(resolver: Resolver, admits: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    void resolveAdmitted(resolver, hostname, admits).then(
      (addresses) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: Error) => callback(error, ''),
    );
  };
}

/**
 * Resolves both families of `hostname`, rejecting unless there is an answer and every address is admitted.
 * It keeps only the first address of each family.
 */
async function resolveAdmitted(
  resolver: Resolver,
  hostname: string,
  admits: (ip: string) => boolean,
): Promise<LookupAddress[]> {
  const [v4, v6] = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);
  const four = answers(v4, 4);
  const six = answers(v6, 6);
  const addresses = [...four, ...six];
  if (addresses.length === 0) throw fetchPublicError('unreachable');
  if (!addresses.every(({ address }) => admits(address))) throw fetchPublicError('refused');
  return [...four.slice(0, 1), ...six.slice(0, 1)];
}

/**
 * Matches an address on one of the host's own networks, or a platform address.
 * A whole network counts, since an on-link neighbor is reachable from the host but not from the internet.
 * Interfaces are read on each call, since DHCP and SLAAC rotate them.
 */
function hostLocalMatcher(): (ip: string) => boolean {
  const networks = Object.values(networkInterfaces()).flatMap((list = []) =>
    list.flatMap(({ cidr }) => cidr ?? []),
  );
  return createCIDRMatcher([...networks, ...PLATFORM]);
}

/**
 * The addresses of one family's resolution, none when it failed.
 */
function answers(result: PromiseSettledResult<string[]>, family: 4 | 6): LookupAddress[] {
  return result.status === 'fulfilled' ? result.value.map((address) => ({ address, family })) : [];
}
