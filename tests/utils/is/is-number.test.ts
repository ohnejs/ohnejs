import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isNumber } from '../../../src/utils/index.ts';

describe('isNumber', () => {
  it('returns true for finite and infinite numbers', () => {
    strictEqual(isNumber(0), true);
    strictEqual(isNumber(-1.5), true);
    strictEqual(isNumber(Infinity), true);
    strictEqual(isNumber(-Infinity), true);
  });

  it('returns false for NaN', () => {
    strictEqual(isNumber(NaN), false);
  });

  it('returns false for non-numbers', () => {
    strictEqual(isNumber('1'), false);
    strictEqual(isNumber(null), false);
    strictEqual(isNumber(undefined), false);
    strictEqual(isNumber(true), false);
  });
});
