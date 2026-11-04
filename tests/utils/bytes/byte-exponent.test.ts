import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { byteExponent } from '../../../src/utils/index.ts';

describe('byteExponent', () => {
  it('picks the largest unit that keeps the count at 1 or more', () => {
    strictEqual(byteExponent(0), 0);
    strictEqual(byteExponent(1023), 0);
    strictEqual(byteExponent(1536), 1);
    strictEqual(byteExponent(1024 ** 3), 3);
  });

  it('moves up when rounding reaches 1024', () => {
    strictEqual(byteExponent(1023.6), 1);
    strictEqual(byteExponent(1024 ** 2 - 1), 2);
    strictEqual(byteExponent(1024 ** 2 - 1, 3), 1);
  });

  it('stops at petabytes', () => {
    strictEqual(byteExponent(1024 ** 7), 5);
  });
});
