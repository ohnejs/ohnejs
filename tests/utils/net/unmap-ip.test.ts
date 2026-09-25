import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { unmapIP } from '../../../src/utils/net/index.ts';

describe('unmapIP', () => {
  it('normalizes an IPv4-mapped IPv6 address to its IPv4 form', () => {
    strictEqual(unmapIP('::ffff:127.0.0.1'), '127.0.0.1');
    strictEqual(unmapIP('::ffff:10.0.0.1'), '10.0.0.1');
  });

  it('unmaps every spelling of a mapped address', () => {
    strictEqual(unmapIP('::ffff:7f00:1'), '127.0.0.1');
    strictEqual(unmapIP('::FFFF:A9FE:A9FE'), '169.254.169.254');
    strictEqual(unmapIP('0:0:0:0:0:ffff:a9fe:a9fe'), '169.254.169.254');
    strictEqual(unmapIP('0:0:0:0:0:ffff:127.0.0.1'), '127.0.0.1');
    strictEqual(unmapIP('::ffff:0:0'), '0.0.0.0');
  });

  it('leaves a plain IPv4 address unchanged', () => {
    strictEqual(unmapIP('127.0.0.1'), '127.0.0.1');
  });

  it('leaves a non-mapped IPv6 address unchanged', () => {
    strictEqual(unmapIP('fd00::1'), 'fd00::1');
    strictEqual(unmapIP('::1'), '::1');
  });

  it('leaves the translated and compatible forms unchanged', () => {
    strictEqual(unmapIP('::ffff:0:7f00:1'), '::ffff:0:7f00:1');
    strictEqual(unmapIP('::127.0.0.1'), '::127.0.0.1');
  });

  it('leaves anything that is not an address unchanged', () => {
    strictEqual(unmapIP('Thrall'), 'Thrall');
    strictEqual(unmapIP('[::ffff:7f00:1]'), '[::ffff:7f00:1]');
    strictEqual(unmapIP(''), '');
  });
});
