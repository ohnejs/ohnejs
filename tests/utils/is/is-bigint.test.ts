import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isBigInt } from '../../../src/utils/index.ts';

describe('isBigInt', () => {
  it('returns true for bigints', () => {
    strictEqual(isBigInt(42n), true);
    strictEqual(isBigInt(0n), true);
    strictEqual(isBigInt(-1n), true);
  });

  it('returns false for numbers', () => {
    strictEqual(isBigInt(42), false);
    strictEqual(isBigInt(0), false);
  });

  it('returns false for non-bigint values', () => {
    strictEqual(isBigInt('42n'), false);
    strictEqual(isBigInt(null), false);
    strictEqual(isBigInt(undefined), false);
  });
});
