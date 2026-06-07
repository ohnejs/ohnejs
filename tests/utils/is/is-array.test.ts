import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isArray } from '../../../src/utils/index.ts';

describe('isArray', () => {
  it('returns true for arrays', () => {
    strictEqual(isArray([]), true);
    strictEqual(isArray([1, 2]), true);
  });

  it('returns false for non-arrays', () => {
    strictEqual(isArray({}), false);
    strictEqual(isArray('a,b'), false);
    strictEqual(isArray(null), false);
    strictEqual(isArray(new Set()), false);
  });
});
