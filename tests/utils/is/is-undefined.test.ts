import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isUndefined } from '../../../src/utils/index.ts';

describe('isUndefined', () => {
  it('returns true for undefined', () => {
    strictEqual(isUndefined(undefined), true);
    strictEqual(isUndefined(void 0), true);
  });

  it('returns false for null and other values', () => {
    strictEqual(isUndefined(null), false);
    strictEqual(isUndefined(0), false);
    strictEqual(isUndefined(''), false);
  });
});
