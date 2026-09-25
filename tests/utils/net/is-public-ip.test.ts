import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPublicIP } from '../../../src/utils/net/index.ts';

type Row = [ip: string, expected: boolean, why: string];

/**
 * The rows whose verdict differs from the expected one, so a failure lists every wrong row at once.
 */
function mismatches(rows: Row[]): Row[] {
  return rows.filter(([ip, expected]) => isPublicIP(ip) !== expected);
}

describe('isPublicIP', () => {
  it('admits public IPv4 and refuses every special IPv4 block', () => {
    const rows: Row[] = [
      ['8.8.8.8', true, 'public'],
      ['1.1.1.1', true, 'public'],
      ['93.184.215.14', true, 'public'],
      ['223.255.255.255', true, 'last unicast before multicast'],
      ['0.0.0.0', false, 'this host'],
      ['0.1.2.3', false, 'this network 0/8'],
      ['10.1.2.3', false, 'private 10/8'],
      ['172.16.0.1', false, 'private 172.16/12'],
      ['172.31.255.255', false, 'private 172.16/12 edge'],
      ['172.32.0.1', true, 'just past 172.16/12'],
      ['172.15.255.255', true, 'just before 172.16/12'],
      ['192.168.1.1', false, 'private 192.168/16'],
      ['100.64.0.1', false, 'shared 100.64/10'],
      ['100.100.100.200', false, 'Alibaba metadata in 100.64/10'],
      ['100.127.255.255', false, 'shared 100.64/10 edge'],
      ['100.63.255.255', true, 'just before 100.64/10'],
      ['100.128.0.1', true, 'just past 100.64/10'],
      ['127.0.0.1', false, 'loopback'],
      ['127.255.255.254', false, 'loopback'],
      ['169.254.169.254', false, 'metadata, link-local'],
      ['169.254.170.2', false, 'ECS metadata, link-local'],
      ['192.0.0.192', false, 'Oracle metadata in 192.0.0/24'],
      ['192.0.0.170', false, 'NAT64 discovery in 192.0.0/24'],
      ['192.0.1.1', true, 'just past 192.0.0/24'],
      ['192.0.2.1', false, 'TEST-NET-1'],
      ['192.88.99.1', false, '6to4 relay anycast'],
      ['198.18.0.1', false, 'benchmarking 198.18/15'],
      ['198.19.255.255', false, 'benchmarking 198.18/15 edge'],
      ['198.17.255.255', true, 'just before 198.18/15'],
      ['198.20.0.0', true, 'just past 198.18/15'],
      ['198.51.100.1', false, 'TEST-NET-2'],
      ['203.0.113.1', false, 'TEST-NET-3'],
      ['224.0.0.1', false, 'multicast'],
      ['239.255.255.250', false, 'SSDP multicast'],
      ['240.0.0.1', false, 'reserved 240/4'],
      ['255.255.255.255', false, 'limited broadcast'],
    ];
    deepStrictEqual(mismatches(rows), []);
  });

  it('admits global unicast IPv6 and refuses every special IPv6 block', () => {
    const rows: Row[] = [
      ['2606:4700:4700::1111', true, 'public'],
      ['2A00:1450:4001::1', true, 'public, uppercase'],
      ['2620:4f:8000::1', true, 'AS112, globally reachable'],
      ['2001:200::1', true, 'just past 2001::/23'],
      ['2001:db9::1', true, 'just past documentation 2001:db8::/32'],
      ['2003::1', true, 'just past 6to4 2002::/16'],
      ['3fff:1000::1', true, 'just past documentation 3fff::/20'],
      ['::', false, 'unspecified'],
      ['::1', false, 'loopback'],
      ['100::1', false, 'discard-only'],
      ['1fff:ffff::1', false, 'below 2000::/3'],
      ['4000::1', false, 'above 2000::/3'],
      ['5f00::1', false, 'SRv6 SIDs'],
      ['2001::1', false, 'Teredo'],
      ['2001:0:4136:e378:8000:63bf:3fff:fdd2', false, 'Teredo'],
      ['2001:2::1', false, 'benchmarking'],
      ['2001:10::1', false, 'ORCHID'],
      ['2001:20::1', false, 'ORCHIDv2'],
      ['2001:1ff:ffff::1', false, '2001::/23 edge'],
      ['2001:db8::1', false, 'documentation 2001:db8::/32'],
      ['3fff::1', false, 'documentation 3fff::/20'],
      ['3fff:fff:ffff::1', false, 'documentation 3fff::/20 edge'],
      ['2002::1', false, '6to4'],
      ['fc00::1', false, 'unique local fc00::/7'],
      ['fdff:ffff::1', false, 'unique local fc00::/7 edge'],
      ['fd00:ec2::254', false, 'AWS metadata, unique local'],
      ['fd20:ce::254', false, 'GCP metadata, unique local'],
      ['fe80::1', false, 'link-local fe80::/10'],
      ['febf::1', false, 'link-local fe80::/10 edge'],
      ['fec0::1', false, 'site-local fec0::/10'],
      ['ff02::1', false, 'multicast'],
      ['ff0e::1', false, 'global multicast'],
    ];
    deepStrictEqual(mismatches(rows), []);
  });

  it('judges IPv4-mapped and NAT64 addresses by the IPv4 they embed', () => {
    const rows: Row[] = [
      ['::ffff:8.8.8.8', true, 'mapped public, dotted'],
      ['::ffff:808:808', true, 'mapped public, hex'],
      ['::FFFF:8.8.8.8', true, 'mapped public, uppercase'],
      ['0:0:0:0:0:ffff:808:808', true, 'mapped public, uncompressed'],
      ['0000:0000:0000:0000:0000:ffff:0808:0808', true, 'mapped public, zero-padded'],
      ['::ffff:127.0.0.1', false, 'mapped loopback, dotted'],
      ['::ffff:7f00:1', false, 'mapped loopback, hex'],
      ['::FFFF:A9FE:A9FE', false, 'mapped metadata, uppercase hex'],
      ['0:0:0:0:0:ffff:a9fe:a9fe', false, 'mapped metadata, uncompressed'],
      ['::ffff:10.0.0.1', false, 'mapped private, dotted'],
      ['::ffff:a00:1', false, 'mapped private, hex'],
      ['::ffff:c0a8:101', false, 'mapped 192.168.1.1, hex'],
      ['::ffff:6440:1', false, 'mapped shared 100.64.0.1, hex'],
      ['::ffff:0.0.0.0', false, 'mapped this host'],
      ['::ffff:ffff:ffff', false, 'mapped broadcast'],
      ['64:ff9b::808:808', true, 'NAT64 public, hex'],
      ['64:ff9b::1.1.1.1', true, 'NAT64 public, dotted'],
      ['64:ff9b::7f00:1', false, 'NAT64 loopback, hex'],
      ['64:ff9b::127.0.0.1', false, 'NAT64 loopback, dotted'],
      ['64:ff9b::a9fe:a9fe', false, 'NAT64 metadata'],
      ['64:ff9b::a00:1', false, 'NAT64 private 10/8'],
      ['64:ff9b::192.168.1.1', false, 'NAT64 private 192.168/16'],
      ['64:ff9b::6440:1', false, 'NAT64 shared 100.64/10'],
      ['64:ff9b::c612:1', false, 'NAT64 benchmarking 198.18/15'],
      ['64:ff9b::c000:2', false, 'NAT64 192.0.0/24'],
      ['64:ff9b::c000:201', false, 'NAT64 TEST-NET-1'],
      ['64:ff9b::e000:1', false, 'NAT64 multicast'],
      ['64:ff9b::f000:1', false, 'NAT64 reserved 240/4'],
      ['64:ff9b::ffff:ffff', false, 'NAT64 broadcast'],
      ['64:ff9b::', false, 'NAT64 this host'],
      ['64:ff9b:0:0:1::808:808', false, 'outside the NAT64 /96'],
      ['64:ff9b:1::808:808', false, 'local-use NAT64, refused whole'],
      ['::127.0.0.1', false, 'IPv4-compatible, refused whole'],
      ['::7f00:1', false, 'IPv4-compatible, hex'],
      ['::808:808', false, 'IPv4-compatible public, refused whole'],
      ['::ffff:0:7f00:1', false, 'IPv4-translated, refused whole'],
      ['::ffff:0:808:808', false, 'IPv4-translated public, refused whole'],
      ['2002:7f00:1::', false, '6to4 loopback'],
      ['2002:808:808::', false, '6to4 public, refused whole'],
    ];
    deepStrictEqual(mismatches(rows), []);
  });

  it('refuses zone ids, non-canonical forms and anything that is not an address', () => {
    const rows: Row[] = [
      ['fe80::1%lo0', false, 'link-local, zoned'],
      ['2606:4700::1111%en0', false, 'zoned global fails closed'],
      ['2606:4700::1111%25en0', false, 'percent-encoded zone'],
      ['', false, 'empty'],
      ['localhost', false, 'a name'],
      ['0x7f.1', false, 'hex shorthand'],
      ['2130706433', false, 'decimal'],
      ['127.1', false, 'short form'],
      ['08.08.08.08', false, 'leading zeros'],
      ['1.2.3', false, 'three parts'],
      ['256.1.1.1', false, 'octet out of range'],
      ['8.8.8.8.8', false, 'five parts'],
      ['8.8.8.8/32', false, 'a CIDR'],
      ['8.8.8.8:80', false, 'with a port'],
      ['[2606:4700::1111]', false, 'bracketed'],
      [' 8.8.8.8', false, 'leading space'],
      ['::g', false, 'not hex'],
      [':::1', false, 'too many colons'],
    ];
    deepStrictEqual(mismatches(rows), []);
  });
});
