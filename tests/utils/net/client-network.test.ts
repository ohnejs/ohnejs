import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { clientNetwork } from '../../../src/utils/net/index.ts';

describe('clientNetwork', () => {
  it('counts every address of one IPv6 /64 as one network', () => {
    strictEqual(clientNetwork('2001:db8:1:2::7'), '2001:db8:1:2::/64');
    strictEqual(clientNetwork('2001:DB8:1:2:ffff::1'), '2001:db8:1:2::/64');
  });

  it('keeps an IPv4 address as is', () => {
    strictEqual(clientNetwork('203.0.113.7'), '203.0.113.7');
  });

  it('keeps an unknown IP empty', () => {
    strictEqual(clientNetwork(''), '');
  });
});
