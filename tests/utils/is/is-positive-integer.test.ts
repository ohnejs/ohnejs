import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isPositiveInteger } from '../../../src/utils/index.ts';

describe('isPositiveInteger', () => {
  it('returns true for positive safe integers', () => {
    strictEqual(isPositiveInteger(1), true);
    strictEqual(isPositiveInteger(Number.MAX_SAFE_INTEGER), true);
  });

  it('returns false for zero and negatives', () => {
    strictEqual(isPositiveInteger(0), false);
    strictEqual(isPositiveInteger(-1), false);
  });

  it('returns false for non-integers and unsafe integers', () => {
    strictEqual(isPositiveInteger(1.5), false);
    strictEqual(isPositiveInteger(Number.MAX_SAFE_INTEGER + 1), false);
    strictEqual(isPositiveInteger(NaN), false);
  });
});
