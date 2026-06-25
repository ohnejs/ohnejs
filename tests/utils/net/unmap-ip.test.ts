import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { unmapIP } from '../../../src/utils/net/index.ts';

describe('unmapIP', () => {
  it('normalizes an IPv4-mapped IPv6 address to its IPv4 form', () => {
    strictEqual(unmapIP('::ffff:127.0.0.1'), '127.0.0.1');
    strictEqual(unmapIP('::ffff:10.0.0.1'), '10.0.0.1');
  });

  it('leaves a plain IPv4 address unchanged', () => {
    strictEqual(unmapIP('127.0.0.1'), '127.0.0.1');
  });

  it('leaves a non-mapped IPv6 address unchanged', () => {
    strictEqual(unmapIP('fd00::1'), 'fd00::1');
    strictEqual(unmapIP('::1'), '::1');
  });
});
