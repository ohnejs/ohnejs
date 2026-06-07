import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isNullish } from '../../../src/utils/index.ts';

describe('isNullish', () => {
  it('returns true for null and undefined', () => {
    strictEqual(isNullish(null), true);
    strictEqual(isNullish(undefined), true);
  });

  it('returns false for other falsy values', () => {
    strictEqual(isNullish(0), false);
    strictEqual(isNullish(''), false);
    strictEqual(isNullish(false), false);
    strictEqual(isNullish(NaN), false);
  });
});
