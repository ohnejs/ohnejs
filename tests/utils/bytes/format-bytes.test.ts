import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { formatBytes, parseBytes } from '../../../src/utils/index.ts';

describe('formatBytes', () => {
  it('renders sub-1024 counts as whole bytes', () => {
    strictEqual(formatBytes(0), '0b');
    strictEqual(formatBytes(512), '512b');
    strictEqual(formatBytes(1023), '1023b');
    strictEqual(formatBytes(512.6), '513b');
  });

  it('picks the largest unit at or above 1', () => {
    strictEqual(formatBytes(1024), '1kb');
    strictEqual(formatBytes(1024 ** 2), '1mb');
    strictEqual(formatBytes(1024 ** 3), '1gb');
    strictEqual(formatBytes(1024 ** 4), '1tb');
  });

  it('keeps fractional units, trimming trailing zeros', () => {
    strictEqual(formatBytes(1536), '1.5kb');
    strictEqual(formatBytes(1234567), '1.18mb');
  });

  it('honors the decimals argument', () => {
    strictEqual(formatBytes(1234567, 1), '1.2mb');
    strictEqual(formatBytes(1234567, 0), '1mb');
  });

  it('rolls over to the next unit when rounding reaches 1024', () => {
    strictEqual(formatBytes(1023.6), '1kb');
    strictEqual(formatBytes(1024 ** 2 - 1), '1mb');
    strictEqual(formatBytes(1024 ** 3 - 1), '1gb');
    strictEqual(formatBytes(1024 * 1023.9, 0), '1mb');
  });

  it('clamps past the largest unit', () => {
    strictEqual(formatBytes(1024 ** 6), '1024pb');
  });

  it('round-trips through parseBytes', () => {
    strictEqual(parseBytes(formatBytes(1610612736)), 1610612736);
    strictEqual(parseBytes(formatBytes(1024)), 1024);
  });

  it('throws on negative, NaN, and Infinity', () => {
    throws(() => formatBytes(-1), /Invalid byte size/);
    throws(() => formatBytes(NaN), /Invalid byte size/);
    throws(() => formatBytes(Infinity), /Invalid byte size/);
  });
});
