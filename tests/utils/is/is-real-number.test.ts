import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isRealNumber } from '../../../src/utils/index.ts';

describe('isRealNumber', () => {
  it('returns true for finite numbers', () => {
    strictEqual(isRealNumber(0), true);
    strictEqual(isRealNumber(1.5), true);
    strictEqual(isRealNumber(-7), true);
  });

  it('returns false for NaN and Infinity', () => {
    strictEqual(isRealNumber(NaN), false);
    strictEqual(isRealNumber(Infinity), false);
    strictEqual(isRealNumber(-Infinity), false);
  });

  it('returns false for non-numbers', () => {
    strictEqual(isRealNumber('1'), false);
    strictEqual(isRealNumber(null), false);
  });
});
