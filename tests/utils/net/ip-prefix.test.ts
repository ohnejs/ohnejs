import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { ipPrefix } from '../../../src/utils/net/index.ts';

describe('ipPrefix', () => {
  it('masks every spelling of one IPv6 network to the same /64', () => {
    for (const ip of ['2001:db8:1:2:aaaa::1', '2001:DB8:1:2::ffff', '2001:0db8:0001:0002:0:0:0:0'])
      strictEqual(ipPrefix(ip, 64), '2001:db8:1:2::/64');
  });

  it('masks inside a group', () => {
    strictEqual(ipPrefix('2001:db8:ffff::', 35), '2001:db8:e000::/35');
  });

  it('reads a dotted IPv4 tail', () => {
    strictEqual(ipPrefix('::ffff:1.2.3.4', 112), '::ffff:1.2.0.0/112');
  });

  it('ignores a zone', () => {
    strictEqual(ipPrefix('fe80::1%eth0', 64), 'fe80::/64');
  });

  it('masks IPv4', () => {
    strictEqual(ipPrefix('203.0.113.7', 24), '203.0.113.0/24');
    strictEqual(ipPrefix('203.0.113.7', 32), '203.0.113.7/32');
    strictEqual(ipPrefix('203.0.113.7', 0), '0.0.0.0/0');
  });

  it('throws on a malformed IP or a prefix outside the address width', () => {
    throws(() => ipPrefix('nonsense', 24), /Invalid IP/);
    throws(() => ipPrefix('203.0.113.7', 33), /Invalid prefix length/);
    throws(() => ipPrefix('2001:db8::1', 129), /Invalid prefix length/);
    throws(() => ipPrefix('2001:db8::1', -1), /Invalid prefix length/);
    throws(() => ipPrefix('2001:db8::1', 1.5), /Invalid prefix length/);
  });
});
