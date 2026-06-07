import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isInteger } from '../../../src/utils/index.ts';

describe('isInteger', () => {
  it('returns true for integers', () => {
    strictEqual(isInteger(0), true);
    strictEqual(isInteger(1), true);
    strictEqual(isInteger(-7), true);
  });

  it('returns true at the safe-integer bounds', () => {
    strictEqual(isInteger(Number.MAX_SAFE_INTEGER), true);
    strictEqual(isInteger(Number.MIN_SAFE_INTEGER), true);
  });

  it('returns false for non-integers and unsafe integers', () => {
    strictEqual(isInteger(1.5), false);
    strictEqual(isInteger(Number.MAX_SAFE_INTEGER + 1), false);
    strictEqual(isInteger(2 ** 53), false);
    strictEqual(isInteger(NaN), false);
    strictEqual(isInteger(Infinity), false);
    strictEqual(isInteger('1'), false);
    strictEqual(isInteger(null), false);
  });
});
