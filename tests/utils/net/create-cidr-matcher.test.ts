import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createCIDRMatcher } from '../../../src/utils/index.ts';

describe('createCIDRMatcher', () => {
  it('matches addresses inside a CIDR block and rejects those outside', () => {
    const trusted = createCIDRMatcher(['10.0.0.0/8']);
    strictEqual(trusted('10.1.2.3'), true);
    strictEqual(trusted('10.255.255.255'), true);
    strictEqual(trusted('11.0.0.1'), false);
  });

  it('matches a bare address exactly', () => {
    const trusted = createCIDRMatcher(['127.0.0.1']);
    strictEqual(trusted('127.0.0.1'), true);
    strictEqual(trusted('127.0.0.2'), false);
  });

  it('matches an IPv6 CIDR block', () => {
    const trusted = createCIDRMatcher(['fd00::/8']);
    strictEqual(trusted('fd00::1'), true);
    strictEqual(trusted('fe00::1'), false);
  });

  it('normalizes IPv4-mapped IPv6 to its IPv4 form', () => {
    const trusted = createCIDRMatcher(['127.0.0.0/8']);
    strictEqual(trusted('::ffff:127.0.0.1'), true);
  });

  it('matches nothing for an empty list', () => {
    const trusted = createCIDRMatcher([]);
    strictEqual(trusted('127.0.0.1'), false);
    strictEqual(trusted('::1'), false);
  });

  it('rejects a malformed address', () => {
    const trusted = createCIDRMatcher(['10.0.0.0/8']);
    strictEqual(trusted('nonsense'), false);
    strictEqual(trusted(''), false);
  });
});
